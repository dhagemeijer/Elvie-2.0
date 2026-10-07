/**
 * Ticket port (BUILD_03.md): the generic, TOPdesk-independent contract
 * through which Elvie registers tickets. It replaces the incident-only
 * port and supports the internal intake types incident | request |
 * security. Real TOPdesk ticket types, routing and payload mapping are
 * Build 04/06; Build 03 only simulates registration with fictional data.
 *
 * Submission protocol:
 * - every logical submission carries a content-free SubmissionKey
 *   (session id + attempt number); submit and getStatus use the SAME key,
 *   even when no reference was ever received;
 * - adapters MUST treat an identical key as the same logical submission
 *   (idempotency, no duplicate tickets);
 * - TicketSubmissionResult is a discriminated union: submitted requires a
 *   non-empty reference and exactly the original submissionKey; failed and
 *   inconclusive never carry a confirmed reference;
 * - the engine validates the contract before CONFIRM; an invalid or
 *   contradictory response NEVER reaches CONFIRM.
 */

/** Internal intake type; never silently coerced to another category. */
export type TicketCategory = 'incident' | 'request' | 'security';

/** TOPdesk-independent ticket draft built from structured context facts. */
export interface TicketDraft {
  readonly category: TicketCategory;
  readonly summary: string;
  readonly description: string;
  /** Non-sensitive, structured context facts, flattened as key/value metadata. */
  readonly context: Readonly<Record<string, string>>;
}

/**
 * Content-free logical submission key: session id plus attempt number.
 * Equal keys mean the same logical submission everywhere.
 */
export interface SubmissionKey {
  readonly value: string;
}

/** Build a submission key from the session id and the 1-based attempt. */
export function makeSubmissionKey(sessionId: string, attempt: number): SubmissionKey {
  return { value: sessionId + '#' + String(attempt) };
}

/**
 * Discriminated submission result.
 * - submitted: a non-empty reference and exactly the original submissionKey;
 * - failed: a definitively failed registration (no reference);
 * - inconclusive: the outcome is uncertain (timeout/transport/unknown);
 *   never a confirmed reference.
 */
export type TicketSubmissionResult =
  | { readonly status: 'submitted'; readonly submissionKey: string; readonly reference: string }
  | { readonly status: 'failed'; readonly submissionKey: string; readonly reasonCategory: 'rejected' | 'invalid_draft' }
  | {
      readonly status: 'inconclusive';
      readonly submissionKey: string;
      readonly reasonCategory: 'timeout' | 'transport' | 'unknown_transport';
    };

/** Status check outcome; works even without a previously received reference. */
export type TicketStatusResult =
  | { readonly status: 'submitted'; readonly submissionKey: string; readonly reference: string }
  | { readonly status: 'inconclusive'; readonly submissionKey: string };

export interface TicketPort {
  /**
   * Submit a draft, idempotently per submission key. Timeouts, network
   * interruptions and unknown transport errors are surfaced as exceptions
   * or as status inconclusive by the adapter; the engine maps both to an
   * inconclusive outcome and never resubmits automatically.
   */
  submit(draft: TicketDraft, submissionKey: SubmissionKey): Promise<TicketSubmissionResult>;

  /** Check the status of a logical submission using the same key. */
  getStatus(submissionKey: SubmissionKey): Promise<TicketStatusResult>;
}

/**
 * Contract validation before CONFIRM (BUILD_03.md): a submitted result is
 * only accepted when the reference is non-empty text and the submissionKey
 * exactly matches the key of the original submission attempt.
 */
export function isContractValidSubmission(
  result: TicketSubmissionResult,
  expectedKey: SubmissionKey,
): boolean {
  return (
    result.status === 'submitted' &&
    typeof result.reference === 'string' &&
    result.reference.trim().length > 0 &&
    result.submissionKey === expectedKey.value
  );
}

/** Raised when no ticket implementation is configured. */
export class TicketNotConfiguredError extends Error {
  constructor(message = 'Ticket provider is not configured.') {
    super(message);
    this.name = 'TicketNotConfiguredError';
  }
}

/** Fail-closed ticket implementation for unconfigured compositions. */
export function unconfiguredTicket(): TicketPort {
  return {
    async submit(): Promise<TicketSubmissionResult> {
      throw new TicketNotConfiguredError();
    },
    async getStatus(): Promise<TicketStatusResult> {
      throw new TicketNotConfiguredError();
    },
  };
}
