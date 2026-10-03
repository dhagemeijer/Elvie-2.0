# Elvie 2.0

Elvie 2.0 is an internal digital IT service desk assistant for Gemeente Leidschendam-Voorburg (LV).

## Product goal

Elvie helps employees solve common IT questions themselves where possible and creates a complete, usable TOPdesk incident when self-service is not sufficient.

Elvie is intentionally **not a generative-AI chatbot**. It uses deterministic conversation logic, structured context, knowledge retrieval and controlled routing.

## Core scope

- Launched from the LV intranet; target integration is a floating launcher in the Microsoft/SharePoint environment.
- Microsoft Entra ID is the intended identity boundary and SSO mechanism.
- TOPdesk Knowledge Management is the only knowledge source.
- TOPdesk Incident Management is the only incident destination.
- No general internet access and no external AI/LLM services.
- Security by design and secure by default are release requirements, not later enhancements.

## Project status

**Build 00 — Project Foundation**

Digi Daan 0.20.0 is the functional prototype/reference. Elvie 2.0 is a clean implementation and does not inherit the prototype's single-file architecture.

**Build 01 — Application Foundation (branch `build-01-application-foundation`)**

Local development (no secrets or configuration required):

```bash
npm install
npm run dev        # dev server with fictional mock identity/knowledge/incident data
```

Quality commands:

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run test       # vitest run (unit tests + UI smoke test)
npm run build      # vite production build (fail-closed composition)
npm run verify     # typecheck + lint + test + build
```

Notes:
- The dev server (`npm run dev`) wires fictional mocks so the foundation can be exercised locally.
- The production build contains no mock identity: the unconfigured identity port fails closed by design.
- See the [Build 01 implementation note](BUILD_01_IMPLEMENTATION.md).

See:
- [Architecture](ARCHITECTURE.md)
- [Security principles](SECURITY_PRINCIPLES.md)
- [Audit & logging baseline](AUDIT_LOGGING.md)
- [Roadmap](ROADMAP.md)
- [Functional reference](docs/functional-reference.md)
- [Definition of Done](docs/definition-of-done.md)
