# Definition of Done

A change is Done only when all applicable criteria below are satisfied.

## Functional
- Acceptance criteria are explicit and pass.
- Existing supported behavior remains covered.
- Error and empty states are handled.
- User input already present in ConversationContext is not knowingly requested again.

## Code quality
- TypeScript passes without unresolved type errors.
- Lint/build/tests pass.
- Business rules are not duplicated when a shared domain function is appropriate.
- TOPdesk-specific logic remains behind the adapter boundary.
- No production secret/configuration value is hard-coded.

## Security
- Security impact is recorded.
- Authentication/authorization implications are tested.
- New input crossing a trust boundary is server-validated.
- Least privilege and deny-by-default remain intact.
- Logging is reviewed for personal/sensitive data.
- No new outbound destination is introduced without an architectural decision.
- No external AI/LLM or internet dependency is introduced implicitly.

## Testing
- New business rules have unit tests.
- State transitions have positive and negative tests.
- Regression tests are added for fixed defects.
- Integration boundaries are mocked/stubbed until an approved test environment is available.

## UX & accessibility
- Keyboard operation is supported for new interactive UI.
- Focus behavior is deliberate.
- User-facing errors explain the next action without exposing internals.
- Responsive behavior is checked for the supported surfaces.

## Documentation
- Architecture/security documentation is updated when a decision changes.
- Security impact/evidence is recorded for functional changes.
- Roadmap/changelog is updated where relevant.

## Release rule
A build with a failing applicable security criterion is not releasable merely because the feature works.
