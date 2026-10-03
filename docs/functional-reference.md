# Functional Reference — Digi Daan 0.20 -> Elvie 2.0

Digi Daan 0.20.0 is the working functional prototype. Elvie 2.0 is a clean implementation: this document preserves the useful behavior without preserving the prototype architecture.

## Capabilities to preserve

### Entry points
- Free-text help request.
- Direct choices for incident, request and phishing report.
- Persistent option to contact the Service Desk by Teams where organizationally configured.

### Knowledge-first behavior
- Search knowledge before creating an incident/request where appropriate.
- Present relevant knowledge suggestions.
- Ask whether the suggestion solved the issue.
- Continue to intake when it did not.
- Allow knowledge items to define required information for a request.

### Context-aware intake
- Different question sets for ordinary incidents, hardware/device situations, requests and phishing.
- Preserve prior answers when the flow changes or a new knowledge match is found.
- Collect question/answer context into a useful service-desk description.

### Recognition
- Recognize known applications/devices and aliases.
- Use recognition to avoid redundant questions and support routing/configuration-item selection.
- Device-specific user instructions may be shown where deterministic and verified.

### Urgency
- Detect defined impact indicators and offer an appropriate escalation path.
- Urgency behavior must be explicit and testable; phishing-specific policy remains an organizational decision.

### Phishing
- Dedicated triage including clicked link, entered data, opened attachment, received time and evidence availability.
- Do not tell the user to destroy evidence.

### Input safeguards
- Detect BSN and IBAN using validation where possible.
- Heuristic warnings for document-number patterns may be retained only with clear limitations.
- Server-side controls are mandatory in production; client checks are UX safeguards only.
- Do not log detected sensitive values merely to produce statistics.

### Administration/insight
The prototype contains statistics, changelog, roadmap and connection settings. Elvie 2.0 must reassess these rather than blindly porting them. Administrative access must be authorized server-side.

## Improvements required in Elvie 2.0
- Central ConversationContext.
- Deterministic state machine.
- Ask only for missing information.
- Separate conversation semantics from TOPdesk mappings.
- Preview before incident submission.
- Typed interfaces/contracts.
- Automated tests.
- Entra identity and server-side authorization.
- Server-side validation and auditable logging.
- No production localStorage analytics.
- No broad configurable backend URL from ordinary UI.

## Explicit non-goals
- No generative AI.
- No prediction based on opaque models.
- No internet search.
- No direct TOPdesk API access from the browser.
- No claim that client-side validation is a security boundary.
