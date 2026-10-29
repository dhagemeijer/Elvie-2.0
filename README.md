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
npm run build:simulation  # simulation build with fictional mocks, runs on localhost only
npm run verify     # typecheck + lint + test + build
```

Notes:
- The dev server (`npm run dev`) wires fictional mocks so the foundation can be exercised locally.
- The production build contains no mock identity: the unconfigured identity port fails closed by design.
- See the [Build 01 implementation note](BUILD_01_IMPLEMENTATION.md).

### Vercel Preview simulation (Build 05.3)

Vercel runs `npm run build:vercel` (see `vercel.json` and `scripts/vercel-build.mjs`).

- **Production deployments** always get the fail-closed production build. The bundle does not contain the mock composition.
- **Preview deployments** get the simulation build (fictional mocks only, permanent SIMULATIE badge) only when the project variable `ELVIE_SIMULATION=1` is set **for the Preview environment only**. Without it, previews are fail-closed too. There is no fallback.
- `ELVIE_SIMULATION` present in a Production build, a simulation build for Production, or `NODE_ENV` other than `production` fails the build.
- A simulation artifact runs the mocks only on the exact hostnames baked in at build time (`VERCEL_URL`, `VERCEL_BRANCH_URL`). On any other host, including the production domain if Vercel promotes the same artifact without rebuilding, it uses the fail-closed production composition. This hostname gate is defence in depth. The build-time separation is the primary boundary.
- Requires Vercel's system environment variables to be exposed (default). Enable Vercel Authentication (Deployment Protection) for previews.
- Regression evidence: `tests/simulation-artifact.test.ts` builds both real bundles and runs them on preview, production and other hosts.

See:
- [Architecture](ARCHITECTURE.md)
- [Security principles](SECURITY_PRINCIPLES.md)
- [Audit & logging baseline](AUDIT_LOGGING.md)
- [Roadmap](ROADMAP.md)
- [Functional reference](docs/functional-reference.md)
- [Definition of Done](docs/definition-of-done.md)
