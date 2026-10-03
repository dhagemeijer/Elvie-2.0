# Elvie 2.0 — Security by Design Principles

Status: **mandatory architectural principles**

The objective is not to claim that Elvie can be guaranteed vulnerability-free. The objective is to make security-by-design and secure-by-default demonstrable through architecture, implementation, tests, review and evidence.

## Principles

1. **Authenticate before access** — production access requires the approved Microsoft Entra identity path.
2. **Deny by default** — access and network paths are closed unless explicitly required and approved.
3. **Least privilege** — users, administrators, application identities and TOPdesk credentials receive only required permissions.
4. **Separate user and management planes** — administrative functions are not part of the normal employee interface and are independently authorized server-side.
5. **No secrets client-side** — credentials, backend tokens and secret configuration never ship to the browser.
6. **No direct browser-to-TOPdesk access** — all TOPdesk operations pass through the controlled backend.
7. **Restricted outbound connectivity** — only explicitly approved TOPdesk and required Microsoft platform endpoints are allowed.
8. **Validate at trust boundaries** — client validation improves UX; server validation is authoritative.
9. **Data minimisation and source ownership** — TOPdesk remains the source for service-desk data; Entra remains the source for identity; Elvie persists only what is necessary.
10. **Privacy-sensitive input protection** — PII controls are repeated server-side; detected sensitive values must not be unnecessarily logged.
11. **Explicit authorization** — hiding UI controls is never treated as authorization.
12. **Accountable administration** — successful and failed administrative access plus security-relevant administrative actions are auditable.
13. **Controlled logging** — audit and operational logs record necessary metadata and outcomes, not indiscriminate conversation/TOPdesk content.
14. **Safe failure** — authentication, authorization, configuration or dependency uncertainty fails closed where access/security is involved.
15. **Dependency control** — dependencies are minimized, locked and automatically checked.
16. **Test security requirements** — a feature is incomplete until applicable security acceptance criteria pass.
17. **No unapproved external intelligence** — no generative AI/LLM dependency and no conversation data sent to external AI services.
18. **No runtime source-control dependency** — Git/source control is development tooling only and is outside the production trust boundary.

## Security evidence per change

Every functional change must record security impact, affected trust boundary/data, threat or misuse case where applicable, control implemented, test/evidence and unresolved risk or accepted exception.

## Security gates

Before a production release, at minimum:
- TypeScript/build checks pass;
- unit and integration tests pass;
- authentication/authorization tests pass where applicable;
- management-plane authorization tests pass;
- secret scanning passes;
- dependency/security scanning passes;
- security-relevant configuration is reviewed;
- audit events for new privileged actions are tested;
- no real secrets or personal data are committed to source control;
- known security exceptions are documented and explicitly accepted by the appropriate owner.

An in-app “OWASP self-check” is intentionally not part of the design. Assurance should come from independent development/release controls rather than the application certifying itself.
