/**
 * Ticket port (BUILD_03.md v5.2/v5.2.1): the generic, TOPdesk-independent
 * simulation contract through which Elvie registers tickets. It replaces
 * the incident-only port and supports the internal intake types
 * incident | request | security. Real TOPdesk ticket types, routing and
 * payload mapping are Build 04/06; Build 03 only simulates registration
 * with fictional data.
 *
 * Submission protocol (v5.2 par. 10.1):
 * - every logical submission carries a content-free SubmissionKey
 *   (session id + attempt number); the key travels inside the draft and
 *   is echoed EXACTLY by every result;
 * - adapters MUST treat an identical key as the same logical submission
 *   (idempotency, no duplicate tickets);
 * - TicketSubmissionResult is a discriminated union: submitted requires a
 *   non-empty reference and exactly the original submissionKey; failed and
 *   unknown never carry a reference;
 * - the engine validates the contract before CONFIRM; an invalid or
 *   contradictory response NEVER reaches CONFIRM.
 *
 * Status protocol (v5.2.1 par. 10.1): getStatus returns a discriminated
 * TicketStatusResult. A submitted status carries the non-empty fictitious
 * reference and the exact submissionKey; an unknown status never carries a
 * reference. Invalid or contradictory status responses are treated
 * fail-closed as inconclusive (never CONFIRM).
 */

/** Internal intake type; never silently coerced to another category. */
export type TicketCategory = 'incident' | 'request' | 'security';

/**
 * Content-free logical submission key: session id plus attempt number.
 * Equal keys mean the same logical submission everywhere; it determines
 * idempotency at the port side and is the only identifier that also
 * works when no reference was ever received.
 */
export interface SubmissionKey {
  readonly value: string;
}

/** Build a submission key from the session id and the 1-based attempt. */
export function makeSubmissionKey(sessionId: string, attempt: number): SubmissionKey {
  return { value: sessionId + '#' + String(attempt) };
}

/** TOPdesk-independent ticket draft built from structured context facts. */
export interface TicketDraft {
  readonly category: TicketCategory;
  readonly summary: string;
  readonly description: string;
  /** Non-sensitive, structured context facts (controlled values only). */
  readonly context: Readonly<Record<string, string>>;
  /** Key of this logical submission; echoed exactly by every result. */
  readonly submissionKey: SubmissionKey;
}

/**
 * Discriminated submission result (v5.2 par. 10.1): exactly one outcome
 * per submission.
 * - submitted: a demonstrably successful simulated registration; requires
 *   a non-empty reference and exactly the original submissionKey;
 * - failed: a demonstrably definitive failure; never a reference;
 * - unknown: an uncertain outcome (timeout/transport); never a reference.
 * An invalid or contradictory response is treated by Elvie as unknown:
 * NEVER CONFIRM.
 */
export type TicketSubmissionResult =
  | {
      readonly kind: 'submitted';
      readonly reference: string;
      readonly submissionKey: SubmissionKey;
    }
  | {
      readonly kind: 'failed';
      readonly submissionKey: SubmissionKey;
      readonly reasonCategory: 'rejected' | 'invalid_draft';
    }
  | {
      readonly kind: 'unknown';
      readonly submissionKey: SubmissionKey;
      readonly reasonCategory: 'timeout' | 'transport';
    };

/**
 * Discriminated status result (v5.2.1 par. 10.1). Works with the key
 * alone, even when no reference was ever received.
 * - submitted: the non-empty fictitious reference plus the exact key;
 * - unknown: no reference, only the key.
 */
export type TicketStatusResult =
  | {
      readonly kind: 'submitted';
      readonly submissionKey: SubmissionKey;
      readonly reference: string;
    }
  | {
      readonly kind: 'unknown';
      readonly submissionKey: SubmissionKey;
    };

export interface TicketPort {
  /**
   * Submit a draft, idempotently per submission key (same key, same
   * result, never a second registration).
   */
  submit(draft: TicketDraft): Promise<TicketSubmissionResult>;

  /**
   * Check the status of a logical submission using the key alone;
   * also works when no reference was ever received.
   */
  getStatus(submissionKey: SubmissionKey): Promise<TicketStatusResult>;
}

/**
 * Contract validation for submission results (v5.2 par. 10.1):
 * - submitted is valid only with a non-empty reference and the exact key;
 * - failed/unknown are valid only WITHOUT any reference field and with
 *   the exact key.
 * Anything else is an invalid/contradictory response: the engine treats
 * it as unknown (inconclusive) and never reaches CONFIRM.
 */
export function isContractValidSubmission(
  result: TicketSubmissionResult,
  expectedKey: SubmissionKey,
): boolean {
  if (result.kind === 'submitted') {
    return (
      typeof result.reference === 'string' &&
      result.reference.trim().length > 0 &&
      keyMatches(result.submissionKey, expectedKey)
    );
  }
  if (result.kind === 'failed' || result.kind === 'unknown') {
    return !('reference' in result) && keyMatches(result.submissionKey, expectedKey);
  }
  return false;
}

/**
 * Contract validation for status results (v5.2.1 par. 10.1):
 * - submitted is valid only with a non-empty reference and the exact key;
 * - unknown is valid only WITHOUT any reference field and with the
 *   exact key.
 * Invalid or contradictory status responses are handled fail-closed as
 * inconclusive; they never reach CONFIRM.
 */
export function isContractValidStatus(
  status: TicketStatusResult,
  expectedKey: SubmissionKey,
): boolean {
  if (status.kind === 'submitted') {
    return (
      typeof status.reference === 'string' &&
      status.reference.trim().length > 0 &&
      keyMatches(status.submissionKey, expectedKey)
    );
  }
  if (status.kind === 'unknown') {
    return !('reference' in status) && keyMatches(status.submissionKey, expectedKey);
  }
  return false;
}

function keyMatches(actual: SubmissionKey | undefined, expected: SubmissionKey): boolean {
  return actual !== undefined && actual.value === expected.value;
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
