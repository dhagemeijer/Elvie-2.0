import type { AuditEvent, AuditLoggerPort } from '../ports/logging';

/**
 * In-memory audit sink for development and tests. This is a non-persistent
 * test double: Elvie deliberately has NO local database of conversations or
 * logs. The production audit destination is a later build (see ROADMAP.md
 * Build 08) and will be a centralized, append-only platform sink.
 */
export class InMemoryAuditLogger implements AuditLoggerPort {
  private readonly events: AuditEvent[] = [];

  record(event: AuditEvent): void {
    this.events.push(event);
  }

  get recordedEvents(): readonly AuditEvent[] {
    return this.events;
  }
}
