# Elvie 2.0 — Build 01: Application Foundation

Status: **approved implementation specification**

## Goal

Create the maintainable TypeScript foundation for Elvie without connecting to production services. Build 01 proves the architecture, boundaries and testability before Entra, TOPdesk, SharePoint or production administration are introduced.

## Architectural constraints

The implementation MUST follow the Build 00 documents in the repository. If implementation appears to require a change to architecture, security principles or audit policy, stop and report the proposed change instead of silently modifying those documents.

Non-negotiable:
- TOPdesk is the authoritative source for service-desk knowledge and incident data.
- Entra is the intended authoritative identity source.
- Elvie is the employee interaction layer.
- No generative AI or LLM.
- No general internet integration.
- No runtime dependency on GitHub/source control.
- Browser never communicates directly with TOPdesk.
- User and management planes remain logically separated.
- No real LV, Entra or TOPdesk production data, URLs, credentials, tenant IDs, personal data or secrets.

## Scope

### 1. TypeScript application foundation
Create a clear project structure that separates:
- user interface;
- conversation domain;
- application/services;
- infrastructure/adapters;
- security boundaries;
- logging contracts;
- tests.

Prefer the smallest maintainable dependency set. Do not add a framework or service merely for future convenience.

### 2. ConversationContext
Define a typed central ConversationContext. It must be able to represent facts accumulated during an interaction without requiring TOPdesk-specific fields in the conversation domain.

Initial fields may include:
- conversation/session identifier;
- current conversation state;
- intent;
- service/application;
- device;
- symptom;
- impact;
- urgency;
- start time;
- location;
- affected users;
- attempted solutions;
- security indicators;
- answers already supplied;
- confidence.

Fields not yet known must remain optional/unknown rather than filled with invented defaults.

### 3. Deterministic state machine
Implement the structural lifecycle:

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

Build 01 does not need the final intelligence/rules for each state. It must establish explicit typed states and controlled transitions that can be tested.

Invalid transitions must be rejected deterministically.

### 4. Ports and mock adapters
Define interfaces/ports for external concerns and provide safe local mocks for Build 01.

At minimum:
- identity;
- TOPdesk knowledge access;
- TOPdesk incident submission;
- operational logging;
- audit logging.

The conversation domain must not import or depend on concrete TOPdesk HTTP/API details.

Mocks must contain fictional test data only.

### 5. Identity mock
Provide a development/test identity implementation representing an authenticated employee without pretending to implement Entra.

Administrative identity/authorization may be represented in tests/contracts where needed, but Build 01 must not build a production admin interface.

The production identity port must fail safely when no real implementation is configured.

### 6. Logging contracts
Implement separate contracts for:
- operational logging;
- audit logging.

Follow AUDIT_LOGGING.md.

Tests must demonstrate that prohibited sensitive content is not required by the logging contracts. Do not implement a local database of conversations/logs.

### 7. Initial chat shell
Create a minimal accessible Elvie user interface sufficient to exercise the application foundation.

Required:
- recognizable Elvie entry/chat shell;
- text input;
- submit/send interaction;
- conversation output area;
- keyboard operability;
- visible focus behavior;
- clear empty/error states;
- responsive basic layout.

This is a functional shell, not final visual design.

There must be no admin controls in the employee UI.

### 8. Developer quality commands
Provide repeatable commands for:
- development;
- type checking;
- linting;
- unit tests;
- production build.

A fresh checkout must be able to install dependencies and execute the documented checks without secret configuration.

## Security acceptance criteria

Build 01 is not complete unless:
1. no secrets, credentials, real personal data or production LV/TOPdesk configuration are present;
2. no browser-to-TOPdesk path exists;
3. no external AI/LLM or arbitrary internet call exists;
4. external systems are behind typed ports/adapters;
5. invalid conversation-state transitions have negative tests;
6. production identity behavior does not silently fall back to a privileged/mock identity;
7. employee UI contains no administrative functionality;
8. logging contracts are separated and do not require raw conversation content;
9. dependencies are minimal and locked;
10. typecheck, lint, tests and production build all pass.

## Required tests

At minimum:
- ConversationContext can be created with unknown optional facts;
- valid state transitions succeed;
- invalid state transitions fail;
- repeated context facts can be retained without forcing a repeated question;
- mock knowledge port can return fictional results;
- mock incident port can accept a fictional mapped request;
- production/unconfigured identity does not grant access;
- audit logger accepts a safe structured admin/security event;
- representative sensitive strings are not included in emitted test audit events;
- UI smoke test for initial chat interaction where practical in the selected minimal stack.

## Out of scope for Build 01

Do NOT implement:
- real Entra integration;
- real TOPdesk API calls;
- real SharePoint/SPFx integration;
- production admin UI;
- production database;
- production audit/SIEM integration;
- analytics dashboard;
- attachments;
- real incident routing/category mapping;
- real knowledge ranking;
- LLM/AI integration;
- internet search;
- production deployment.

## Deliverables

- application source;
- tests;
- dependency lockfile;
- README instructions updated with local Build 01 commands where needed;
- concise Build 01 implementation note describing structure, decisions and known limitations.

Do not rewrite Build 00 architecture/security documents as part of implementation.

## Completion report

Before declaring Build 01 complete, report:
- files added/changed;
- architecture choices made within this specification;
- dependency list and why each non-dev runtime dependency is necessary;
- exact results of typecheck, lint, tests and production build;
- security acceptance criteria result 1–10;
- known limitations;
- any requested architecture deviation (which must remain unimplemented until approved).

**Do not merge this branch to main.** Build 01 remains on its branch until reviewed and explicitly approved.
