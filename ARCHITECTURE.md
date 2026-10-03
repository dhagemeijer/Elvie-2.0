# Elvie 2.0 — Target Architecture

Status: **Build 00 architectural baseline**

## Architecture goals

Elvie is an internal LV application with a deliberately small trust surface. The browser never talks directly to TOPdesk. Authentication, authorization, validation, routing and TOPdesk credentials belong on the server side.

## Logical architecture

```text
LV employee
    |
SharePoint / Microsoft 365 intranet
    |
SPFx Elvie launcher
    |
Elvie frontend
    |
Microsoft Entra ID / SSO
    |
Elvie backend API
    |-- authentication / authorization
    |-- conversation engine
    |-- knowledge service
    |-- intake engine
    |-- routing engine
    |-- validation / PII controls
    |-- audit logging
    |-- TOPdesk adapter
    |
Outbound allowlist
    |-- TOPdesk Knowledge Management
    |-- TOPdesk Incident Management
```

## Architectural boundaries

### Frontend
Responsible for presentation and interaction only. It may keep temporary conversation state needed for the user experience, but must not contain secrets, TOPdesk credentials or authoritative authorization decisions.

### Backend
The security boundary and authoritative policy enforcement point. All requests are authenticated and authorized here. Server-side validation must not rely on client-side controls.

### TOPdesk adapter
TOPdesk-specific URLs, credentials, identifiers and payload mappings are isolated behind an adapter. Conversation logic must not depend directly on TOPdesk's internal field model.

### Intranet integration
The intended end state is an SPFx launcher available from the LV SharePoint intranet. The launcher and Elvie application remain logically separate so Elvie can be developed, tested and released independently.

## Conversation architecture

The core is a deterministic state machine, not an LLM.

Target lifecycle:

```text
START
  -> UNDERSTAND
  -> KNOWLEDGE_SEARCH
       -> RESOLVE -> DONE
       -> INTAKE
  -> COMPLETE_CONTEXT
  -> PREVIEW
  -> SUBMIT
  -> CONFIRM
```

A central ConversationContext accumulates facts already supplied or reliably derived. Elvie asks only for missing information and must not knowingly ask the same question twice.

Candidate context includes intent, service/application, device, symptom, impact, urgency, start time, location, affected users, attempted solutions, security indicators, attachments, answers and confidence.

## Network policy

Default: deny.

Permitted business integrations:
1. TOPdesk Knowledge Management.
2. TOPdesk Incident Management.

There is no functional requirement for open internet access, external AI services or third-party analytics.

Exact deployment/network controls will be finalized when the approved LV Azure and TOPdesk environments are known.

## Identity

Target: Microsoft Entra ID SSO. No application-specific password system is planned.

Authorization is role-based and deny-by-default. Initial role model:
- Employee
- Servicedesk
- ElvieAdmin

Exact Entra groups/app roles remain an environment-specific decision.

## Open architecture decisions

Build 00 deliberately does not invent:
- LV tenant IDs, domains, Entra groups or app registrations;
- TOPdesk production URLs, API credentials or category identifiers;
- exact Azure subscription/network topology;
- retention periods or formal logging policy;
- production attachment policy.

These require verified organizational input before implementation.
