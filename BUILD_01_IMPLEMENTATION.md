# Elvie 2.0 — Build 01 Implementation Note

Status: implementation note for `build-01-application-foundation`

## Structure

```text
index.html                    — entry page (chat shell root)
src/
  main.ts                    — entrypoint; fail-closed production wiring, dev-only mock loading
  app/production-composition.ts — production composition: every port fail-closed;
                                   explicit unconfigured audit destination (release blocker)
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
- **Audit event types:** a failed normal employee session is recorded with the neutral event type `employee_session_establishment`. `administrative_*` event types are reserved for genuine administrative access (Build 05+).
- **Production audit destination:** explicitly NOT configured in Build 01. The unconfigured sink throws `AuditDestinationNotConfiguredError` for every event; the engine surfaces this on the operational channel (events are never silently dropped and the console is never an audit destination). Configuring a centralized audit destination is a documented **release blocker** before any production release (ROADMAP.md Build 08).
- **State machine:** transitions implement exactly the ARCHITECTURE.md lifecycle. Invalid transitions throw `InvalidTransitionError` and never mutate state. `DONE` and `CONFIRM` are terminal. `RESOLVE -> INTAKE` is not in the ARCHITECTURE.md diagram and is deliberately NOT implemented; it is pending a separate architectural decision.
- **Answers never re-asked:** the ConversationContext retains supplied answers keyed by logical question; states consult `hasAnswer` semantics rather than re-asking.
- **PII safeguard:** the engine blocks input containing BSN/IBAN-shaped values before storing, searching or submitting, and never logs the value (only a metadata-level warn).
- **CI:** the GitHub Actions verify workflow is control-only: `contents: read`, `npm ci` from the committed lockfile, and typecheck/lint/tests/build must all pass. CI never mutates repository contents and never commits a lockfile.

## Known limitations (by design, later builds)

- State handlers are deterministic skeletons; real intent detection, entity extraction, impact/urgency rules and knowledge ranking arrive in Builds 02–03.
- PII detection is a conservative heuristic (9-digit BSN pattern, IBAN pattern); validated detection and phishing-specific policy are later builds.
- The audit sink in dev/tests is in-memory; the centralized production audit destination is a Build 08 decision and a release blocker until configured.
- Preview has no edit capability yet; Build 04 adds preview/edit/confirm.

## Security notes

- No secrets, credentials, personal data or real LV/Entra/TOPdesk configuration are present; all mock data is fictional.
- No browser-to-TOPdesk path exists; all external concerns sit behind typed ports.
- No external AI/LLM, internet integration, or runtime source-control dependency.
- No administrative functionality exists in the employee UI (there is no admin UI at all in Build 01).
