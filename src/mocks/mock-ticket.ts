import type {
  SubmissionKey,
  TicketCategory,
  TicketDraft,
  TicketPort,
  TicketStatusResult,
  TicketSubmissionResult,
} from '../ports/ticket';

/**
 * Development/test ticket mock (BUILD_03.md v5.2/v5.2.1; BUILD 04D §4/§9):
 * a clearly fictional, TOPdesk-independent simulation with no network
 * calls and no storage.
 *
 * - idempotent per SubmissionKey: the same logical submission never
 *   produces a second ticket; reusing a known key with DIVERGENT content
 *   is a controlled rejection (invalid_draft) that leaves the original
 *   registration untouched;
 * - a deterministic fictional mapping decides whether a draft category is
 *   handled at all: an absent or invalid mapping yields a controlled
 *   failure, never an invented organizational default (R-09);
 * - fictional references use the approved SIM-<category>-<id> format;
 * - timeout and transport failures are returned as kind 'unknown'
 *   results (never thrown), so the engine's discriminated-union handling
 *   is exercised directly; a separate 'exception' mode throws an unknown
 *   transport error to exercise the engine's exception path;
 * - configurable contract-violation modes cover the negative regression
 *   tests (empty reference, wrong submission key, status-check exception);
 * - this mock NEVER logs draft content and NEVER represents a real
 *   TOPdesk registration;
 * - SCOPE: all protection (key registry, idempotency, in-flight claim) is
 *   in-memory and valid ONLY for a demonstrably single-instance mock
 *   runtime. Cross-instance and crash/restart durability (shared
 *   authoritative attempt claim, durable key/outcome recovery) is a
 *   Build 06 release design gate and is explicitly NOT claimed here.
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

/** Fictional, deterministic mock mapping entry (never a real TOPdesk value). */
export interface MockTicketMappingEntry {
  readonly operatorGroup: string;
}

/** Mock-only mapping of internal categories to fictional operator groups. */
export type MockTicketMapping = Readonly<Partial<Record<TicketCategory, MockTicketMappingEntry>>>;

/** Approved fictional default mapping; every category is explicitly mapped. */
export const DEFAULT_MOCK_TICKET_MAPPING: Readonly<Record<TicketCategory, MockTicketMappingEntry>> = {
  incident: { operatorGroup: 'Simulatie Servicedesk — Incidenten (fictief)' },
  request: { operatorGroup: 'Simulatie Servicedesk — Aanvragen (fictief)' },
  security: { operatorGroup: 'Simulatie Servicedesk — Beveiliging (fictief)' },
};

export interface MockTicketProviderOptions {
  readonly failureMode?: MockTicketFailureMode;
  /** Let getStatus throw (negative test: inconclusive stays inconclusive). */
  readonly statusCheckMode?: 'normal' | 'exception';
  /**
   * BUILD 04D §4/§9: deterministic fictional category mapping. An absent or
   * invalid entry yields a controlled failure, never an invented default.
   */
  readonly mapping?: MockTicketMapping;
}

/**
 * Canonical, key-order-independent content signature of a draft (the
 * submission key itself is excluded: it identifies the attempt, not the
 * content). Used to detect divergent content reusing a known key.
 */
function canonicalContentSignature(draft: TicketDraft): string {
  const context: Record<string, string> = {};
  for (const key of Object.keys(draft.context).sort()) {
    context[key] = draft.context[key];
  }
  return JSON.stringify({
    category: draft.category,
    summary: draft.summary,
    description: draft.description,
    context,
  });
}

export class MockTicketProvider implements TicketPort {
  private counter = 0;
  private failureMode: MockTicketFailureMode;
  private readonly statusCheckMode: 'normal' | 'exception';
  private readonly mapping: MockTicketMapping;
  private readonly submissions = new Map<string, TicketSubmissionResult>();
  private readonly contentSignatures = new Map<string, string>();
  private readonly statuses = new Map<string, TicketStatusResult>();
  private readonly drafts: TicketDraft[] = [];
  private submitAttempts = 0;
  private lastSubmissionKey: SubmissionKey | undefined;
  private divergentContentRejections = 0;
  private unmappedCategoryRejections = 0;

  constructor(options: MockTicketProviderOptions = {}) {
    this.failureMode = options.failureMode ?? 'success';
    this.statusCheckMode = options.statusCheckMode ?? 'normal';
    this.mapping = options.mapping ?? DEFAULT_MOCK_TICKET_MAPPING;
  }

  /** Change behaviour between logical attempts (test helper). */
  setFailureMode(mode: MockTicketFailureMode): void {
    this.failureMode = mode;
  }

  async submit(draft: TicketDraft): Promise<TicketSubmissionResult> {
    this.submitAttempts += 1;
    const key = draft.submissionKey;
    this.lastSubmissionKey = key;
    const signature = canonicalContentSignature(draft);
    const existing = this.submissions.get(key.value);
    if (existing !== undefined) {
      if (this.contentSignatures.get(key.value) !== signature) {
        // BUILD 04D §4: the same logical submission key with divergent
        // content is a controlled rejection; the existing registration
        // stays exactly as it was.
        this.divergentContentRejections += 1;
        return { kind: 'failed', submissionKey: key, reasonCategory: 'invalid_draft' };
      }
      // Idempotent per key: the same logical submission, same result.
      return existing;
    }
    const mappingEntry = this.mapping[draft.category];
    if (mappingEntry === undefined || mappingEntry.operatorGroup.trim().length === 0) {
      // BUILD 04D §4/§9 (R-09): no mapping means a controlled failure;
      // never an invented operator group, category or default.
      this.unmappedCategoryRejections += 1;
      return { kind: 'failed', submissionKey: key, reasonCategory: 'invalid_draft' };
    }
    const result = this.buildResult(draft, key);
    if (result !== undefined) {
      this.submissions.set(key.value, result);
      this.contentSignatures.set(key.value, signature);
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

  /** Controlled rejections of a known key with divergent content (§4). */
  get divergentContentRejectionCount(): number {
    return this.divergentContentRejections;
  }

  /** Controlled rejections of drafts without a valid mapping (§4/R-09). */
  get unmappedCategoryRejectionCount(): number {
    return this.unmappedCategoryRejections;
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
