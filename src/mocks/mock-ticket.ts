import type { SubmissionKey, TicketDraft, TicketPort, TicketStatusResult, TicketSubmissionResult } from '../ports/ticket';

/**
 * Development/test ticket mock (BUILD_03.md): a clearly fictional,
 * TOPdesk-independent simulation with no network calls and no storage.
 *
 * - idempotent per SubmissionKey: the same logical submission never
 *   produces a second ticket;
 * - fictional references use the approved SIM-<category>-<id> format;
 * - configurable failure modes cover the negative regression tests
 *   (definitive failure, timeout/transport exception, empty reference,
 *   wrong submission key, status-check exception);
 * - this mock NEVER represents a real TOPdesk registration; the engine
 *   communicates the simulation status to the employee.
 */
export type MockTicketFailureMode =
  | 'success'
  | 'fail_rejected'
  | 'fail_invalid_draft'
  | 'timeout'
  | 'transport'
  | 'empty_reference'
  | 'wrong_key';

export interface MockTicketProviderOptions {
  readonly failureMode?: MockTicketFailureMode;
  /** Let getStatus throw (negative test: inconclusive stays inconclusive). */
  readonly statusCheckMode?: 'normal' | 'exception';
}

export class MockTicketProvider implements TicketPort {
  private counter = 0;
  private failureMode: MockTicketFailureMode;
  private readonly statusCheckMode: 'normal' | 'exception';
  private readonly submissions = new Map<string, TicketSubmissionResult>();
  private readonly statuses = new Map<string, TicketStatusResult>();
  private readonly drafts: TicketDraft[] = [];
  private submitCallCount = 0;
  private lastSubmissionKey: SubmissionKey | undefined;

  constructor(options: MockTicketProviderOptions = {}) {
    this.failureMode = options.failureMode ?? 'success';
    this.statusCheckMode = options.statusCheckMode ?? 'normal';
  }

  /** Change behaviour between logical attempts (test helper). */
  setFailureMode(mode: MockTicketFailureMode): void {
    this.failureMode = mode;
  }

  async submit(draft: TicketDraft, submissionKey: SubmissionKey): Promise<TicketSubmissionResult> {
    this.submitCallCount += 1;
    this.lastSubmissionKey = submissionKey;
    const existing = this.submissions.get(submissionKey.value);
    if (existing !== undefined) {
      // Idempotent per key: the same logical submission, same result.
      return existing;
    }
    const result = this.buildResult(draft, submissionKey);
    this.submissions.set(submissionKey.value, result);
    if (result.status === 'submitted' && result.reference.trim().length > 0) {
      this.drafts.push(draft);
      this.statuses.set(submissionKey.value, {
        status: 'submitted',
        submissionKey: submissionKey.value,
        reference: result.reference,
      });
    }
    return result;
  }

  async getStatus(submissionKey: SubmissionKey): Promise<TicketStatusResult> {
    if (this.statusCheckMode === 'exception') {
      throw new Error('Simulated status check failure');
    }
    const known = this.statuses.get(submissionKey.value);
    if (known !== undefined) {
      return known;
    }
    // Unknown outcome without any received reference.
    return { status: 'inconclusive', submissionKey: submissionKey.value };
  }

  /**
   * Test helper: simulate the backend later confirming an uncertain
   * submission (recovery via getStatus, never via a second submit).
   */
  resolveAsSubmitted(reference = 'SIM-incident-0421'): void {
    const key = this.lastSubmissionKey;
    if (key === undefined) {
      throw new Error('No submission key captured yet.');
    }
    this.statuses.set(key.value, { status: 'submitted', submissionKey: key.value, reference });
  }

  /** Accepted drafts (fictional data only). */
  get submittedDrafts(): readonly TicketDraft[] {
    return this.drafts;
  }

  /** Number of actual submit calls (idempotency assertions). */
  get submitCallCount(): number {
    return this.submitCallCount;
  }

  private buildResult(draft: TicketDraft, submissionKey: SubmissionKey): TicketSubmissionResult {
    switch (this.failureMode) {
      case 'success':
        this.counter += 1;
        return {
          status: 'submitted',
          submissionKey: submissionKey.value,
          reference: 'SIM-' + draft.category + '-' + String(this.counter).padStart(4, '0'),
        };
      case 'fail_rejected':
        return { status: 'failed', submissionKey: submissionKey.value, reasonCategory: 'rejected' };
      case 'fail_invalid_draft':
        return { status: 'failed', submissionKey: submissionKey.value, reasonCategory: 'invalid_draft' };
      case 'timeout':
        // Exception path: the engine maps this to an inconclusive outcome.
        throw new Error('Simulated submission timeout');
      case 'transport':
        throw new Error('Simulated transport failure');
      case 'empty_reference':
        // Deliberate contract violation for the negative regression test.
        return { status: 'submitted', submissionKey: submissionKey.value, reference: '' };
      case 'wrong_key':
        // Deliberate contract violation for the negative regression test.
        return {
          status: 'submitted',
          submissionKey: submissionKey.value + '-other',
          reference: 'SIM-' + draft.category + '-9999',
        };
    }
  }
}
