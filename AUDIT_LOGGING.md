# Elvie 2.0 — Audit & Logging Baseline

Status: **Build 00 baseline; production retention and monitoring ownership TBD**

## Purpose

Logging must support operations, security monitoring, accountability and evidence without creating an unnecessary secondary store of employee conversations or TOPdesk data.

Elvie distinguishes two log classes.

### Operational logging
Used to determine whether the service is healthy and to diagnose technical failures. Examples: request correlation ID, component, timestamp, duration, dependency result, error category and health state.

### Audit logging
Used to establish who performed a security-relevant or privileged action, what action was attempted, on which logical object/configuration, when it happened and whether it succeeded.

## Minimum audit events

Administrative/security events should include, where technically applicable:
- successful administrative authentication/session establishment;
- failed administrative authentication where visible to the application/platform;
- administrative logout/session termination where useful;
- authorization denial for privileged operations;
- administrator role/permission change where Elvie controls or observes it;
- Elvie-specific configuration create/change/delete;
- security configuration change;
- enable/disable of a feature that affects security or data processing;
- privileged diagnostic or support action;
- production deployment/release/configuration activation where available from the platform;
- audit/logging configuration changes;
- TOPdesk write operation outcome at an appropriate metadata level, without duplicating incident content.

## Audit event shape

Target fields:
- event timestamp in a consistent timezone;
- event type;
- authenticated actor identifier from the trusted identity context;
- actor role/authorization context where useful;
- action;
- target type and non-sensitive identifier;
- outcome: success/denied/failed;
- correlation/request ID;
- source component;
- reason/error category when safe;
- application/build version.

## Never log by default

- passwords, secrets, API keys or access tokens;
- BSN, IBAN or identity-document numbers;
- complete conversation transcripts;
- complete TOPdesk knowledge articles;
- complete incident descriptions or attachments;
- raw authentication tokens;
- sensitive values merely because they were rejected by validation.

Where troubleshooting requires additional data, it must be deliberately designed, time-bounded where appropriate and privacy/security reviewed.

## Integrity and access

Production audit records must not be modifiable through the normal Elvie user interface or ordinary Elvie administration. Access to logs follows least privilege. The production destination should support centralized retention, access control and monitoring independent of the application process.

## Correlation

Elvie should use correlation IDs so an interaction can be traced across frontend/backend/TOPdesk operations without storing the full user conversation in every log entry.

## Retention and monitoring

Build 00 does not invent retention periods, SIEM tooling, alert thresholds or operational ownership. These must be agreed with the LV security/privacy/operations stakeholders and implemented using the approved Microsoft environment.

## Testability

Every new privileged action must define its expected audit event and include a test that verifies:
1. the event is emitted;
2. the actor and outcome are correct;
3. prohibited sensitive content is absent.
