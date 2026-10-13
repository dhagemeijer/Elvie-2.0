import type {
  SubmissionKey,
  TicketDraft,
  TicketPort,
  TicketStatusResult,
  TicketSubmissionResult,
} from '../ports/ticket';

/**
 * Development/test ticket mock (BUILD_03.md v5.2/v5.2.1): a clearly
 * fictional, TOPdesk-independent simulation with no network calls and
 * no storage.
 *
 * - idempotent per SubmissionKey: the same logical submission never
 *   produces a second ticket;
 * - fictional references use the approved SIM-<category>-<id> format;
 * - timeout and transport failures are returned as kind 'unknown'
 *   results (never thrown), so the engine's discriminated-union handling
 *   is exercised directly; a separate 'exception' mode throws an unknown
 *   transport error to exercise the engine's exception path;
 * - configurable contract-violation modes cover the negative regression
 *   tests (empty reference, wrong submission key, status-check exception);
 * - this mock NEVER represents a real TOPdesk registration; the engine
 *   communicates the simulation status to the employee.
 */
export type MockTicketFailureMode =
  | 'success'
  | 'fail_rejected'
  | 'fail_invalid_draft'
  | 'timeout'
  | 'transport'
  | 'exception'
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
  private submitAttempts = 0;
  private lastSubmissionKey: SubmissionKey | undefined;

  constructor(options: MockTicketProviderOptions = {}) {
    this.failureMode = options.failureMode ?? 'success';
    this.statusCheckMode = options.statusCheckMode ?? 'normal';
  }

  /** Change behaviour between logical attempts (test helper). */
  setFailureMode(mode: MockTicketFailureMode): void {
    this.failureMode = mode;
  }

  async submit(draft: TicketDraft): Promise<TicketSubmissionResult> {
    this.submitAttempts += 1;
    const key = draft.submissionKey;
    this.lastSubmissionKey = key;
    const existing = this.submissions.get(key.value);
    if (existing !== undefined) {
      // Idempotent per key: the same logical submission, same result.
      return existing;
    }
    const result = this.buildResult(draft, key);
    if (result !== undefined) {
      this.submissions.set(key.value, result);
    }
    if (
      result !== undefined &&
      result.kind === 'submitted' &&
      result.reference.trim().length > 0
    ) {
      this.drafts.push(draft);
      this.statuses.set(key.value, {
        kind: 'submitted',
        submissionKey: key,
        reference: result.reference,
      });
    }
    return result as TicketSubmissionResult;
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
    return { kind: 'unknown', submissionKey };
  }

  /**
   * Test helper: simulate the backend later confirming an uncertain
   * submission (recovery via getStatus with the SAME key, never via a
   * second submit).
   */
  resolveAsSubmitted(reference = 'SIM-incident-0421'): void {
    const key = this.lastSubmissionKey;
    if (key === undefined) {
      throw new Error('No submission key captured yet.');
    }
    this.statuses.set(key.value, { kind: 'submitted', submissionKey: key, reference });
  }

  /** Accepted drafts (fictional data only). */
  get submittedDrafts(): readonly TicketDraft[] {
    return this.drafts;
  }

  /** Number of actual submit calls (idempotency/recovery assertions). */
  get submitCallCount(): number {
    return this.submitAttempts;
  }

  private buildResult(
    draft: TicketDraft,
    submissionKey: SubmissionKey,
  ): TicketSubmissionResult | undefined {
    switch (this.failureMode) {
      case 'success':
        this.counter += 1;
        return {
          kind: 'submitted',
          submissionKey,
          reference: 'SIM-' + draft.category + '-' + String(this.counter).padStart(4, '0'),
        };
      case 'fail_rejected':
        return { kind: 'failed', submissionKey, reasonCategory: 'rejected' };
      case 'fail_invalid_draft':
        return { kind: 'failed', submissionKey, reasonCategory: 'invalid_draft' };
      case 'timeout':
        // Uncertain outcome: returned as kind 'unknown' (v5.2 par. 10.1).
        return { kind: 'unknown', submissionKey, reasonCategory: 'timeout' };
      case 'transport':
        return { kind: 'unknown', submissionKey, reasonCategory: 'transport' };
      case 'exception':
        // Exception path: the engine maps this to an inconclusive outcome.
        throw new Error('Simulated unknown transport failure');
      case 'empty_reference':
        // Deliberate contract violation for the negative regression test.
        return { kind: 'submitted', submissionKey, reference: '' };
      case 'wrong_key':
        // Deliberate contract violation for the negative regression test.
        return {
          kind: 'submitted',
          submissionKey: { value: submissionKey.value + '-other' },
          reference: 'SIM-' + draft.category + '-9999',
        };
    }
  }
}
