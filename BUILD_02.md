# Elvie 2.0 — Build 02: Conversation Core

Status: **implementation specification (awaiting approval — no application code yet)**

## Goal

Build 02 introduces the deterministic Conversation Core: the capability that transforms employee free-text input into reliable structured ConversationContext and determines what information is still missing.

Elvie is NOT a general natural-language assistant. The core pipeline is deterministic:

```text
Employee message
    ↓
Input normalisation
    ↓
Intent classification
    ↓
Fact extraction
    ↓
Context merge (precedence rules)
    ↓
Missing-information calculation
    ↓
Conversation decision
    ↓
Next question / next eligible action
```

The Build 01 state machine remains the authoritative lifecycle. The Conversation Core may calculate or recommend the next action, but must never bypass or silently redefine allowed state transitions.

## Architectural constraints (non-negotiable)

Unchanged from Build 00/Build 01 and restated here for the implementing change:

- TOPdesk remains the authoritative source for service-desk knowledge and incident data.
- Entra remains the intended authoritative identity source.
- Elvie is the employee interaction layer.
- No generative AI or LLM; no external AI/NLP service; no general internet integration.
- No runtime dependency on GitHub/source control.
- The browser never communicates directly with TOPdesk.
- User and management planes remain separated.
- No real LV, Entra or TOPdesk production data, URLs, tenant IDs, credentials, secrets or personal data. All Build 02 test content is fictional/generic.
- Build 02 must be fully testable without Entra, TOPdesk, SharePoint or production infrastructure (mocks and in-memory implementations only).
- Elvie must not become a second TOPdesk catalogue/CMDB/knowledge store.
- Knowledge search/ranking and guided resolution belong to **Build 03** and must NOT be implemented in Build 02.

If implementation appears to require a change to ARCHITECTURE.md,
 SECURITY_PRINCIPLES.md or AUDIT_LOGGING.md, stop and report the conflict instead of silently modifying those documents.

## Domain model changes

### 1. Intent classification

Intents (unchanged from the Build 01 type): `incident` | `request` | `phishing` | `unknown`.

Classification is deterministic and explainable. Every classification result carries:

- `value`: one of the four intents;
- `confidence`: qualitative — `high` | `medium` | `low` (never pseudo-statistical such as 0.83; no justified statistical model exists);
- `evidence`: the concise list of matched rule identifiers and matched text spans that justify the value.

`unknown` is a valid and safe result. Insufficient evidence must never be converted into a confident classification merely to keep the conversation moving.

Model: an ordered, immutable **rule set** (`IntentRule[]`), each rule with a stable `ruleId`, an intent, a qualitative confidence contribution, and deterministic matchers (normalized phrase / keyword / pattern over the normalized input). Rules are evaluated in a fixed, documented order; the winning rule(s) and their evidence become the classification record. Ties are resolved by a documented deterministic tie-break (rule order), never by randomness.

Conceptual example:

> "Mijn Outlook doet het niet sinds vanochtend."
> intent = incident, confidence = high,
> evidence: ["doet het niet" (rule:incident_symptom_phrase), "sinds vanochtend" (rule:incident_time_phrase)]

The exact rule model must be finalized in this document's approval before coding (see "Open design decisions" below).

### 2. Fact extraction

The Conversation Core extracts service-desk facts from employee messages where they can be determined reliably. Fact categories (aligned with the Build 01 ConversationContext fields):

- service/application
- device
- symptom
- impact
- urgency
- start time
- location
- affected users
- attempted solutions
- security indicators

Unknown facts remain unknown; never invent a default merely because a value would be useful later.

Every extracted fact distinguishes:

- **explicit** facts supplied by the employee (matched against the RecognitionCatalog / explicit patterns), and
- **derived** facts deterministically concluded from explicit evidence (e.g. "niet meer in kunnen" → symptom = unavailable).

Every fact (explicit or derived) is stored as a structured record, not a bare string:

```tsinterface FactRecord<T = string> {
  value: T;                       // canonical value
  kind: 'explicit' | 'derived';
  sourceRuleId?: string;           // for derived facts: the rule that concluded it
  evidence?: readonly string[];    // concise matched spans / rule evidence
  capturedAtTurn: number;           // logical conversation turn ordering (1-based); NOT wall-clock time
}
```

Derived facts must carry rule/evidence metadata sufficient for testing and diagnostics. Do NOT store unrestricted hidden reasoning or chain-of-thought; only the concise rule identifier and evidence spans required to explain the deterministic decision.

Conceptual example:

> "Ik kan sinds vanmorgen op mijn laptop niet meer in Outlook."
> application = Outlook (explicit), device = laptop (explicit), startTime = vanmorgen (explicit), symptom = unavailable (derived, rule:login_block_phrase), intent = incident (derived).

### 3. Fact precedence and conflict resolution

Explicit precedence rules, implemented as merge logic in the Conversation Core:

1. An **explicit** employee statement takes precedence over an **inferred/derived** value.
2. An inferred value must never silently overwrite an explicit value.
3. A **later explicit correction** replaces an earlier explicit value: within the same fact category, a later explicit fact replaces an earlier explicit fact whenever the new utterance unambiguously supplies a new value for that category. Correction markers ("sorry", "trouwens", "ik bedoel") may strengthen/confirm correction detection but are NOT required.
4. Conflicting information is handled deterministically: a documented precedence order (turn order for explicit facts; explicit > derived) resolves every merge without guessing.
5. Uncertainty is never silently resolved by guessing: `clarification_required` is used only when the new information is genuinely ambiguous for the required fact. Example: "Het probleem speelt op mijn laptop en telefoon." may require clarification when the active rule requires one specific device.

Conceptual example:

> Turn 1: "Het probleem is op mijn laptop."
> Turn 2: "Het is op mijn telefoon."

The active device becomes `telefoon` (turn 2 unambiguously supplies a new explicit value for the same category, without any correction marker). This also holds for "Outlook werkt niet op mijn laptop." → "Sorry, het is op mijn telefoon."; there the marker only strengthens detection. This is representable without permanently storing complete conversation transcripts: the ConversationContext keeps only the current active FactRecord per fact category plus the minimal evidence needed to explain it; superseded values are replaced, not archived as transcript.

### 4. Recognition catalog

Build 02 uses controlled **fictional/generic** recognition vocabulary for development and testing. Examples:

- Outlook: outlook, mail, e-mail, mailbox
- Laptop: laptop, notebook
- Phone: telefoon, mobiel, smartphone

The Conversation Core must NOT hard-code a permanent copy of the LV/TOPdesk service catalogue. Instead define a clean domain abstraction:

```tsinterface RecognitionCatalog {
  applications: readonly CatalogEntry[];   // canonical name + aliases
  devices: readonly CatalogEntry[];
  locations?: readonly CatalogEntry[];
}
interface CatalogEntry {
  canonical: string;                        // canonical value stored in facts
  aliases: readonly string[];               // normalized aliases incl. casing variants
}
```

Build 02 ships a small fictional/generic catalog as mock/dev configuration (and for tests). The conversation domain depends only on the `RecognitionCatalog` abstraction, never on TOPdesk HTTP/API details. A later build may supply the catalog from an appropriate authoritative/configured source; that source decision is out of scope here.

### 5. Missing-information engine

Core Build 02 capability:

```textknown facts + requirements(current intent/situation) → missing facts
    → highest-priority missing fact → next question
```

Design:

- A deterministic **conditional requirement model**: NOT one static required-fact list per intent (that would cause Elvie to ask irrelevant questions). Missing facts are calculated from:

```text
intent
  + known facts
  + recognized subject (service/application/device where relevant)
  + applicable requirement rules
  → missing facts
  → highest-priority relevant missing fact
```

- **Requirement rules** are deterministic, ordered rules that conditionally apply based on the intent, the known facts and the recognized subject. Required rule behavior (fictional Build 02 rule set):
  - a **printer** incident must not require an application;
  - an **account** problem must not automatically require a device;
  - an **application** problem may require a device only where the applicable rule says it is relevant;
  - an **access request** requires the requested resource/target;
  - a **security** case uses the applicable security clarification requirements (e.g. when indicators are already sufficient, no further security questions).
- The engine evaluates the applicable rules in fixed order and subtracts facts already reliably known (explicit or confidently derived), yielding the relevant `missingFacts` in priority order.
- Build 02 implements this mechanism plus a small fictional rule set; full production intake requirements remain **Build 04**.
- The highest-priority missing fact maps deterministically to the next question.

**NEVER KNOWINGLY ASK TWICE** is implemented as actual business logic: before proposing a question for fact category X, the engine checks whether the ConversationContext already contains a reliable answer for X (explicit FactRecord, or a derived FactRecord, or a recorded answer). If so, X is not missing and no question is produced. This must be implemented in the Conversation Core (not merely in UI behavior) and must have positive and negative tests:

- positive: a question is proposed for each genuinely missing required fact;
- negative: with device already known ("Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi."), the engine never proposes "Op welk apparaat ervaar je dit?"

The existing Build 01 `answers` map (question-keyed) is retained and integrated with the fact model so already-answered questions are never re-asked.

### 6. Conversation decisions

A typed, deterministic result of the Conversation Core:

```tstype ConversationDecision =
  | { kind: 'sufficient_understanding' }        // enough to continue to next state action
  | { kind: 'missing_information'; missingFacts: readonly FactCategory[]; nextQuestion: QuestionForFact }
  | { kind: 'clarification_required'; fact: FactCategory; reason: string }  // deterministic conflict/ambiguity
  | { kind: 'security_sensitive_route'; indicators: readonly SecurityIndicator[] }
  | { kind: 'unknown_understanding' };          // unsupported / insufficient input; 
ask for clarification, stay in state
```

This is NOT an alternative state machine. The ConversationState lifecycle (START → UNDERSTAND → …) remains authoritative; the decision describes what information/action is appropriate within the current state. State transitions remain only via the Build 01 state machine.

### 7. Security / phishing signals

Phishing **intent** and security **indicators** are related but distinct concepts:

- Security indicators (deterministic, conservative):

  - suspicious message received
  - suspicious link clicked
  - credentials entered after suspicious link
  - suspected account compromise

- Example: "Ik heb op een link in een vreemde mail geklikt en daarna mijn wachtwoord ingevuld." must produce the appropriate indicators (link clicked + credentials entered).

Constraints:

- the word "mail" alone must not trigger phishing intent;
- an Outlook availability problem must not become phishing merely because email is involved;
- detection is conservative and deterministic (rule-based with evidence);
- Build 02 must NOT automatically contact an external service or submit a TOPdesk incident on security signals. Security indicators may affect the ConversationDecision (security-sensitive route), but all actions remain inside the approved state-machine and security boundaries.
- Sensitive-value protection remains mandatory: no passwords, credentials, raw sensitive input or full transcripts in logs (see §12 and SECURITY_PRINCIPLES.md / AUDIT_LOGGING.md). Note: a phrase like "mijn wachtwoord ingevuld" is an indicator, not a credential value — indicator metadata must reference the rule, never the raw credential text.

### 8. Confidence model — migration from Build 01

Build 01 ConversationContext has `confidence?: number` on the whole context. Build 02 evolves this so confidence belongs to individual derived conclusions rather than one vague value for the entire conversation.

Target conceptual model:

```textfacts       — FactRecord per category (explicit/derived, with evidence)
conclusions — intent classification record + derived facts (each: value, source, confidence, evidence)
answers     — retained Build 01 answer map (question-keyed)
```

**Migration (explicit):**

- The field `confidence?: number` on ConversationContext is **removed** in Build 02 (**approved at specification review**), replaced by per-record qualitative confidence (`high` | `medium` | `low`) on the intent classification and on derived FactRecords. No deprecated compatibility field is kept: there is no persisted production conversation model yet.
- This is a typed-domain change to `src/domain/conversation-context.ts`. Build 01 code referencing `context.confidence` must be updated in the same change; existing Build 01 tests are updated accordingly where they assert the old field (behavior otherwise unchanged).
- No persistence format exists yet, so there is no runtime data migration; only a source/type migration, covered by updated tests.

### 9. Input normalisation

Build 02 tolerates ordinary informal Dutch employee input without pretending to implement full NLP:

- lowercase folding;
- whitespace collapsing/trimming;
- simple punctuation stripping (period, comma, question mark, exclamation mark, quotes);
- explicitly defined alias/variant folding via the RecognitionCatalog and a small documented contraction map (e.g. "mn" → "mijn", "'t" → "het", "doet t" → "doet het") — each alias explicitly listed, nothing probabilistic.

This deliberately small deterministic map is **approved at specification review** and must not be expanded substantially in this specification. Example: "hoi elvie mn outlook doet t sinds vanochtend niet op laptop" must remain reasonably processable after normalisation.

No large NLP framework; no fuzzy probabilistic language interpretation; no stemming library unless clearly justified at review (default: none).

### 10. Test corpus (Dutch, fictional/generic)

The implementation must cover at minimum the corpus below, expanded where necessary for rule precedence and edge cases. All names/data are fictional.

**A. Incidents**
- "Mijn Outlook doet het niet."
- "De printer doet het niet."
- "Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi."
- "Outlook werkt niet maar Teams wel."
- "Mijn laptop doet raar."

**B. Requests**
- "Ik wil een nieuwe muis."
- "Kan ik toegang krijgen tot de gedeelde mailbox Financiën?"
- "Ik wil graag software laten installeren."

**C. Security / phishing**
- "Ik heb een verdachte mail gekregen."
- "Ik heb op een link in een vreemde mail geklikt."
- "Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld."
- "Volgens mij is mijn account gehackt."

**D. Unknown / ambiguous**
- "Kun je me helpen?"
- "Het werkt niet."
- "Ik heb een vraag."

**E. Informal input**
- "hoi elvie mn outlook doet t sinds vanochtend niet op laptop"

**F. Corrections**
- Turn 1: "Outlook werkt niet op mijn laptop."
- Turn 2: "Sorry, het is trouwens op mijn telefoon."

**G. Negative / false-positive cases (required regression tests)**
- "mail" alone does not imply phishing;
- Teams mentioned as working is not extracted as the broken application ("Outlook werkt niet maar Teams wel." → application = Outlook, not Teams);
- a known device is never requested again (never-ask-twice);
- unknown information is not invented;
- explicit facts are not overwritten by weaker inference;
- a later explicit correction replaces an earlier value.

### 11. Determinism requirement

For identical input, existing ConversationContext, RecognitionCatalog and rule configuration, the Conversation Core must produce the same result. No random decisions; no network-based interpretation; no LLM; no time-dependent classification unless time is explicitly provided as an input dependency (e.g. a caller-supplied "now" used only for explicitly designed relative-time resolution — default Build 02 stores start-time expressions verbatim without resolving them to clock time).

### 12. Privacy and logging

Build 02 complies with SECURITY_PRINCIPLES.md and AUDIT_LOGGING.md:

- no logging of raw employee messages for debugging convenience;
- operational diagnostics use rule identifiers, classification outcome, safe fact types, correlation IDs and safe error categories — not conversation content;
- sensitive values must not appear in emitted audit/operational test events (existing Build 01 sensitive-value tests must keep passing and be extended to Conversation Core outputs).

### 13. Out of scope for Build 02

Do NOT implement: real TOPdesk Knowledge calls; knowledge ranking; guided solutions; solved/not-solved knowledge feedback; real TOPdesk incident submission; TOPdesk category mapping; Entra integration; SPFx; production admin UI; production database; production SIEM/log destination; attachments; analytics dashboard; generative AI/LLM; internet search; external NLP service; production deployment.

### 14. Security acceptance criteria

Build 02 is complete only when all of the following are demonstrably met:

1. no production secrets/data/configuration are introduced;
2. no new outbound runtime dependency is introduced;
3. no AI/LLM/external NLP dependency exists;
4. identical inputs/configuration produce identical results (tested);
5. unknown information remains unknown;
6. explicit facts take precedence over inference;
7. later explicit corrections are handled deterministically;
8. known information is not knowingly requested again (business logic, positive + negative tests);
9. phishing/security indicators have false-positive regression tests;
10. sensitive/raw input is not required in logs;
11. state-machine boundaries remain enforced (all transitions via the Build 01 state machine only);
12. all existing Build 01 security tests continue to pass;
13. dependencies remain minimal and locked (no new runtime dependencies);
14. typecheck, lint, tests and production build pass in CI.

### 15. Required test areas

Unit/regression tests for at least:

- normalisation;
- intent classification;
- unknown intent;
- confidence/evidence (qualitative confidence and evidence present on derived conclusions);
- application recognition;
- device recognition;
- symptom extraction;
- impact/affected-user extraction;
- security indicators;
- false-positive phishing cases;
- explicit vs inferred precedence;
- later corrections;
- context merge (including conflict handling);
- missing-information calculation;
- never-ask-twice (positive and negative);
- ambiguous input;
- deterministic repeated execution (same inputs → same outputs);
- state-machine compatibility (decisions never bypass transitions);
- safe logging (no raw input/sensitive values in events);
- existing Build 01 behavior (regression).

### 16. Completion report (after implementation)

After eventual implementation, Vibe must report:

- files added/changed;
- domain model changes (incl. the confidence-field migration from §8);
- rule model and precedence (final rule identifiers and order);
- RecognitionCatalog design (contract + fictional default catalog);
- test corpus size and categories;
- dependency changes and justification (expected: none);
- migration from Build 01 confidence model;
- exact typecheck/lint/test/build outcomes (CI link + result);
- security acceptance criteria results 1–14;
- known limitations;
- architecture deviations requested but NOT implemented.

## Open design decisions (for review, decided before implementation)

1. **Confidence migration:** DECIDED — removal of `confidence?: number` with a clean type migration (§8); approved at specification review; no compatibility field.
2. **Requirement model contents:** DECIDED — the conditional requirement model (§5) replaces static per-intent lists; Build 02 implements the mechanism plus a small fictional conditional rule set (printer/account/application/access/security rule behavior as specified).
3. **Correction detection:** DECIDED — corrections do not depend on markers; a later explicit fact that unambiguously supplies a new value for the same category replaces the earlier one (§3). Markers may strengthen detection but are not required; `clarification_required` only for genuine ambiguity.
4. **Contraction map scope:** DECIDED — the intentionally minimal informal-Dutch variant list (§9) is approved; not expanded substantially in this specification.

## Deliverables (this task)

- `BUILD_02.md` (this specification) on branch `build-02-conversation-core`;
- `ROADMAP.md` Build 02 entry made consistent with this specification (link added; qualitative per-conclusion confidence wording);
- no application source changes; no tests yet.

**Do not merge to main.** Implementation starts only after review and explicit approval.
