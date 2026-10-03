# Elvie 2.0 — Target Architecture

Status: **Build 00 architectural baseline**

## Architecture goals

Elvie is an internal LV interaction layer for the IT service desk with a deliberately small trust surface.

**Source-of-truth rule:** TOPdesk is the authoritative source for service-desk knowledge and incident data. Elvie is the interaction layer with the employee. Elvie must not become a second TOPdesk or duplicate authoritative data without a documented technical need.

Identity is provided by Microsoft Entra ID. The browser never talks directly to TOPdesk. Authentication, authorization, validation, routing and TOPdesk credentials belong on the server side.

## Logical architecture

```text
LV employee
    |
SharePoint / Microsoft 365 intranet
    |
SPFx Elvie launcher
    |
Elvie user frontend
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
    |-- operational logging
    |-- audit logging
    |-- TOPdesk adapter
    |
Outbound allowlist
    |-- TOPdesk Knowledge Management
    |-- TOPdesk Incident Management
```

## Architectural boundaries

### User plane
The normal Elvie experience is for employees. It contains no administrative functionality. The frontend is responsible for presentation and interaction only and contains no secrets or authoritative authorization decisions.

### Management plane
Administrative capabilities are separated from the normal user experience. Administrative access is authenticated and server-authorized independently of whether controls are visible in the UI. Management functionality is kept minimal: Elvie must not reproduce management functions already owned by Entra, TOPdesk or the hosting platform.

### Backend
The security boundary and authoritative policy enforcement point. All requests are authenticated and authorized here. Server-side validation must not rely on client-side controls.

### TOPdesk adapter
TOPdesk-specific URLs, credentials, identifiers and payload mappings are isolated behind an adapter. Conversation logic must not depend directly on TOPdesk's internal field model.

### Intranet integration
The intended end state is an SPFx launcher available from the LV SharePoint intranet. The launcher and Elvie application remain logically separate so Elvie can be developed, tested and released independently.

### Source control
Source control is part of the software-development lifecycle only and is outside Elvie's production trust boundary. Elvie has no runtime dependency on GitHub or any other source-control system. The current development repository must contain no production secrets, personal data or confidential LV production configuration.

## Conversation architecture

The core is a deterministic state machine, not an LLM.

```text
START
  -> UNDERSTAND
  -> KNOWLEDGE_SEARCH
       -> RESOLVE
            -> DONE
            -> INTAKE
       -> INTAKE
  -> COMPLETE_CONTEXT
  -> PREVIEW
  -> SUBMIT
  -> CONFIRM
```

**Resolution decision:** `RESOLVE -> DONE` is used only when the employee confirms that the offered resolution solved the issue. If the offered resolution does not solve the issue, the controlled transition is `RESOLVE -> INTAKE`, after which Elvie gathers the missing context required for TOPdesk. This keeps knowledge-first self-service and incident intake within one deterministic interaction without treating an unsuccessful resolution as complete.

A central ConversationContext accumulates facts already supplied or reliably derived. Elvie asks only for missing information and must not knowingly ask the same question twice.

## Data ownership and minimisation

- TOPdesk owns service-desk knowledge and incident records.
- Entra owns identity.
- Elvie owns only the interaction/session state and Elvie-specific configuration required to perform its function.
- Data is not copied into a second persistent store merely for convenience.
- Retention must be explicitly defined before production.

## Logging

Operational logging and audit logging are separate concerns. See [AUDIT_LOGGING.md](AUDIT_LOGGING.md).

Audit events include administrative authentication and actions, authorization failures, security-relevant configuration changes and other actions for which accountability is required. Logging must not become an uncontrolled copy of conversation or TOPdesk content.

## Network policy

Default: deny.

Permitted business integrations:
1. TOPdesk Knowledge Management.
2. TOPdesk Incident Management.

Required Microsoft platform endpoints for identity/hosting may be allowed explicitly. There is no functional requirement for general internet access, external AI services or third-party analytics.

Exact deployment/network controls will be finalized when the approved LV Azure and TOPdesk environments are known.

## Identity and authorization

Target: Microsoft Entra ID SSO. No application-specific password system is planned.

Normal employee access and administrative access are distinct authorization concerns. Administrative access uses least privilege and deny-by-default. Exact Entra groups/app roles remain an environment-specific decision.

## Open architecture decisions

Build 00 deliberately does not invent:
- LV tenant IDs, domains, Entra groups or app registrations;
- TOPdesk production URLs, API credentials or category identifiers;
- exact Azure subscription/network topology;
- log retention periods, SIEM destination or formal monitoring ownership;
- production attachment policy.

These require verified organizational input before implementation.
