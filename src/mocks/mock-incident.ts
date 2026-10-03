import type { IncidentDraft, IncidentPort, IncidentSubmissionResult } from '../ports/incident';

/**
 * Development/test incident mock: accepts a mapped, TOPdesk-independent
 * request and returns a fictional reference. No network calls, no storage.
 */
export class MockIncidentProvider implements IncidentPort {
  private counter = 0;
  private readonly submitted: IncidentDraft[] = [];

  async submit(draft: IncidentDraft): Promise<IncidentSubmissionResult> {
    this.counter += 1;
    this.submitted.push(draft);
    const reference = `MOCK-INCIDENT-${String(this.counter).padStart(4, '0')}`;
    return { reference };
  }

  /** Test helper: inspect the drafts that were accepted (fictional data only). */
  get submittedDrafts(): readonly IncidentDraft[] {
    return this.submitted;
  }
}
