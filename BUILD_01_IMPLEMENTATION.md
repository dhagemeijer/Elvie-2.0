# Elvie 2.0 — Build 01 Implementation Note

Status: implementation note for `build-01-application-foundation`

## Structure

```text
index.html                    — entry page (chat shell root)
src/
  main.ts                    — entrypoint; fail-closed production wiring, dev-only mock loading
  app/production-composition.ts — production composition: every port fail-closed
  dev/dev-engine.ts          — dev composition with fictional mocks (dynamic import, pruned from prod build)
  domain/                    — conversation domain (no TOPdesk/UI knowledge)
    conversation-context.ts  — typed central ConversationContext
    state-machine.ts         — deterministic lifecycle states and transitions
  ports/                     — typed ports for external concerns
    identity.ts, knowledge.ts, incident.ts, logging.ts
  services/conversation-engine.ts — deterministic skeleton binding domain + ports
  security/sensitive-values.ts    — server-side PII safeguard (heuristic BSN/IBAN detection)
  ui/chat-shell.ts, ui/elvie.css  — minimal accessible chat shell
  mocks/                     — safe local mocks (fictional data only)
  support/                   — id/timestamp helpers, app metadata
tests/                       — unit tests + UI smoke test (Vitest, happy-dom)
```

## Decisions within the specification

- **Stack:** TypeScript, Vite, Vitest, vanilla TS UI (no UI framework), happy-dom for the UI smoke test. Zero runtime dependencies; all dependencies are dev-only.
- **Fail-closed composition:** `src/app/production-composition.ts` wires `unconfiguredIdentity/Knowledge/Incident` ports that always reject. There is no silent fallback to mocks; dev mocks load only through a dynamic import behind `import.meta.env.DEV`, which the production build statically excludes.
- **State machine:** transitions implement exactly the ARCHITECTURE.md lifecycle. Invalid transitions throw `InvalidTransitionError` and never mutate state. `DONE` and `CONFIRM` are terminal.
- **Answers never re-asked:** the ConversationContext retains supplied answers keyed by logical question; states consult `hasAnswer` semantics rather than re-asking.
- **PII safeguard:** the engine blocks input containing BSN/IBAN-shaped values before storing, searching or submitting, and never logs the value (only a metadata-level warn).
- **Audit events:** emitted for session-establishment failures and incident submission outcome (success/failed), per AUDIT_LOGGING.md field shape, without conversation content.

## Known limitations (by design, later builds)

- State handlers are deterministic skeletons; real intent detection, entity extraction, impact/urgency rules and knowledge ranking arrive in Builds 02–03.
- `RESOLVE -> INTAKE` (knowledge did not solve after all) is **not** in the ARCHITECTURE.md diagram and is therefore not implemented; flagged for architectural confirmation (see completion report).
- PII detection is a conservative heuristic (9-digit BSN pattern, IBAN pattern); validated detection and phishing-specific policy are later builds.
- The audit sink in dev/tests is in-memory; the production destination is a Build 08 decision. The unconfigured production sink surfaces events on the console for now and is called out as a known limitation.
- Preview has no edit capability yet; Build 04 adds preview/edit/confirm.

## Security notes

- No secrets, credentials, personal data or real LV/Entra/TOPdesk configuration are present; all mock data is fictional.
- No browser-to-TOPdesk path exists; all external concerns sit behind typed ports.
- No external AI/LLM, internet integration, or runtime source-control dependency.
- No administrative functionality exists in the employee UI (there is no admin UI at all in Build 01).
