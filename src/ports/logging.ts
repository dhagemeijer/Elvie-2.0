/**
 * Logging contracts per AUDIT_LOGGING.md. Two separate classes:
 * operational logging (service health/diagnostics) and audit logging
 * (accountability for security-relevant actions). Neither contract carries
 * raw conversation or TOPdesk content.
 */

// ---------------------------------------------------------------------------
// Operational logging
// ---------------------------------------------------------------------------

export type OperationalLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured operational entry: metadata and outcomes only. */
export interface OperationalLogEntry {
  readonly timestamp: string;
  readonly level: OperationalLogLevel;
  readonly component: string;
  readonly correlationId: string;
  readonly message: string;
  readonly durationMs?: number;
  readonly outcome?: 'success' | 'failure';
  readonly errorCategory?: string;
}

export interface OperationalLoggerPort {
  log(entry: OperationalLogEntry): void;
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

export type AuditOutcome = 'success' | 'denied' | 'failed';

/**
 * Structured audit event per AUDIT_LOGGING.md target fields.
 * Deliberately has NO free-text conversation field: incident descriptions,
 * knowledge content and user input have no place here.
 */
export interface AuditEvent {
  readonly timestamp: string;
  readonly eventType: string;
  readonly actorId: string;
  readonly actorRole?: string;
  readonly action: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly outcome: AuditOutcome;
  readonly correlationId: string;
  readonly component: string;
  readonly reason?: string;
  readonly appVersion: string;
}

export interface AuditLoggerPort {
  /** Record one audit event. */
  record(event: AuditEvent): void;
}

/** Convenience factory: build an audit event with required fields. */
export function createAuditEvent(
  base: Pick<AuditEvent, 'eventType' | 'actorId' | 'action' | 'outcome' | 'correlationId' | 'component' | 'appVersion'> &
    Partial<AuditEvent>,
): AuditEvent {
  return {
    timestamp: base.timestamp ?? new Date().toISOString(),
    eventType: base.eventType,
    actorId: base.actorId,
    actorRole: base.actorRole,
    action: base.action,
    targetType: base.targetType,
    targetId: base.targetId,
    outcome: base.outcome,
    correlationId: base.correlationId,
    component: base.component,
    reason: base.reason,
    appVersion: base.appVersion,
  };
}
