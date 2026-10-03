# Elvie 2.0 — Security by Design Principles

Status: **mandatory architectural principles**

The objective is not to claim that Elvie can be guaranteed vulnerability-free. The objective is to make security-by-design and secure-by-default demonstrable through architecture, implementation, tests, review and evidence.

## Principles

1. **Authenticate before access** — production access requires the approved Microsoft Entra identity path.
2. **Deny by default** — access and network paths are closed unless explicitly required and approved.
3. **Least privilege** — users, application identities and TOPdesk credentials receive only required permissions.
4. **No secrets client-side** — credentials, tokens intended for backend use and secret configuration never ship to the browser.
5. **No direct browser-to-TOPdesk access** — all TOPdesk operations pass through the controlled backend.
6. **Restricted outbound connectivity** — the production backend is intended to communicate only with explicitly approved TOPdesk endpoints and required Microsoft platform services.
7. **Validate at trust boundaries** — client validation improves UX; server validation is authoritative.
8. **Data minimisation** — collect, process and log only data necessary for the service desk purpose.
9. **Privacy-sensitive input protection** — PII controls are repeated server-side; detected sensitive values must not be unnecessarily logged.
10. **Explicit authorization** — administrative capabilities require server-enforced roles; hiding UI controls is not authorization.
11. **Auditable security events** — security-relevant actions and failures are logged centrally without creating a new sensitive-data store.
12. **Safe failure** — authentication, authorization, configuration or dependency uncertainty fails closed where access/security is involved.
13. **Dependency control** — dependencies are minimized, pinned/locked and automatically checked.
14. **Test security requirements** — a feature is incomplete until applicable security acceptance criteria pass.
15. **No unapproved external intelligence** — Elvie contains no generative AI/LLM dependency and does not send conversations to external AI services.

## Security evidence per change

Every functional change must record:
- security impact: yes/no;
- affected trust boundary/data;
- threat or misuse case where applicable;
- control implemented;
- test/evidence;
- unresolved risk or accepted exception.

## Security gates

Before a production release, at minimum:
- TypeScript/build checks pass;
- unit and integration tests pass;
- authentication/authorization tests pass where applicable;
- secret scanning passes;
- dependency/security scanning passes;
- security-relevant configuration is reviewed;
- no real secrets or personal data are committed to the repository;
- known security exceptions are documented and explicitly accepted by the appropriate owner.

An in-app “OWASP self-check” is intentionally not part of the design. Assurance should come from independent development/release controls rather than the application certifying itself.
