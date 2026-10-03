/**
 * Incident port: the only contract through which Elvie submits incidents.
 * The request shape is TOPdesk-independent; the future TOPdesk adapter maps
 * it onto Incident Management payloads (Build 04/06).
 */

/** TOPdesk-independent incident draft built from the ConversationContext. */
export interface IncidentDraft {
  readonly summary: string;
  readonly description: string;
  /** Non-sensitive context facts, flattened as key/value metadata. */
  readonly context: Readonly<Record<string, string>>;
}

export interface IncidentSubmissionResult {
  /** Reference of the created incident at the destination system. */
  readonly reference: string;
}

export interface IncidentPort {
  submit(draft: IncidentDraft): Promise<IncidentSubmissionResult>;
}

/** Raised when no incident implementation is configured. */
export class IncidentNotConfiguredError extends Error {
  constructor(message = 'Incident provider is not configured.') {
    super(message);
    this.name = 'IncidentNotConfiguredError';
  }
}

/** Fail-closed incident implementation for unconfigured compositions. */
export function unconfiguredIncident(): IncidentPort {
  return {
    async submit(): Promise<IncidentSubmissionResult> {
      throw new IncidentNotConfiguredError();
    },
  };
}
