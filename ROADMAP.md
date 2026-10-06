# Elvie 2.0 — Roadmap

## Build 00 — Project Foundation
Goal: establish product and security boundaries before implementation.

Deliverables: product scope, target architecture, source-of-truth model, user/management-plane separation, security-by-design principles, audit/logging baseline, functional reference from Digi Daan 0.20, Definition of Done and initial build roadmap. No production integration or real LV/TOPdesk data in this build.

## Build 01 — Application Foundation
Goal: create the maintainable TypeScript application skeleton.

Planned: TypeScript project structure; separation of UI, conversation domain, services and security concerns; central ConversationContext type; deterministic conversation state machine; mock identity and mock TOPdesk ports/adapters; logging interfaces with safe mock implementations; unit-test framework; lint/typecheck/test commands; initial accessible chat shell.

Acceptance focus: architecture and tests, not feature quantity. No real Entra/TOPdesk integration and no production admin interface yet.

## Build 02 — Conversation Core
Planned: incident/request/phishing intent handling; deterministic entity/context extraction; missing-information calculation; “never knowingly ask twice”; device/application recognition; impact and urgency rules; explicit-vs-derived fact precedence with later corrections; qualitative per-conclusion confidence with evidence. Specification: [BUILD_02.md](BUILD_02.md).

## Build 03 — Knowledge & Resolution
Planned: TOPdesk Knowledge abstraction; mock implementation first; ranked deterministic matching; guided resolution; solved/not-solved feedback; transition to intake when self-service fails.

## Build 04 — Intake, Routing & Preview
Planned: context-specific intake; TOPdesk-independent routing model; incident payload mapping in adapter; ticket preview/edit/confirm. Attachments only after organizational requirements are known.

## Build 05 — Microsoft Identity, Authorization & Management Boundary
Planned: Entra ID integration in approved LV environment; employee and administrative authorization boundaries; minimal manageme
nt surface only where Elvie-specific management is required; removal of production mock identity; negative authorization tests; administrative audit events.

## Build 06 — TOPdesk Test Integration
Planned: verify TOPdesk KM API against LV test environment; Incident Management integration; secure credential handling; caller mapping; failure handling; integration tests using non-production data.

## Build 07 — Intranet Integration
Planned: SPFx floating Elvie launcher; intranet UX integration; authenticated handoff/opening behavior; accessibility/responsive validation.

## Build 08 — Production Security, Logging & Observability
Planned: exact CSP allowlist; approved outbound network restrictions; central audit and operational logging; retention/SIEM/monitoring decisions; dependency/secret/security scanning in CI; security acceptance evidence.

## Later candidates
Only after core service value is proven: service-intelligence dashboards, knowledge-gap reporting, improved type-ahead suggestions and additional deterministic flows.

Explicitly out of scope unless the architecture is formally reconsidered: generative AI/LLMs, open internet search, unrelated SaaS integrations and runtime source-control dependencies.
