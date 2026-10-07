import type { IdentityPort } from '../ports/identity';
import type { KnowledgePort } from '../ports/knowledge';
import type { TicketPort } from '../ports/ticket';
import type { AuditEvent, AuditLoggerPort } from '../ports/logging';
import { ConversationEngine } from '../services/conversation-engine';
import { consoleOperationalLogger } from '../mocks/console-operational-logger';
import { unconfiguredIdentity } from '../ports/identity';
import { unconfiguredKnowledge } from '../ports/knowledge';
import { unconfiguredTicket } from '../ports/ticket';

/**
 * Thrown by the audit sink when no production audit destination is wired.
 * AUDIT_LOGGING.md requires a centralized production destination; until the
 * approved Microsoft environment provides one (ROADMAP.md Build 08), this
 * is an EXPLICIT RELEASE BLOCKER, not a working fallback.
 */
export class AuditDestinationNotConfiguredError extends Error {
  constructor() {
    super(
      'Production audit destination is not configured. Audit events cannot be recorded. ' +
        'Configuring a centralized audit destination is a release blocker before any production release (see AUDIT_LOGGING.md and ROADMAP.md Build 08).',
    );
    this.name = 'AuditDestinationNotConfiguredError';
  }
}

/**
 * Fail-safe unconfigured audit sink. Every audit event is rejected with an
 * explicit, descriptive error; the ConversationEngine surfaces the failure
 * on the operational channel (audit events are never silently dropped, and
 * the console is never treated as an audit destination). Tests can assert
 * this behavior via AuditDestinationNotConfiguredError.
 */
export function unconfiguredAuditDestination(): AuditLoggerPort {
  return {
    record(_event: AuditEvent): void {
      throw new AuditDestinationNotConfiguredError();
    },
  };
}

/**
 * Production composition: every external port is fail-closed. Identity
 * rejects access, knowledge and ticket ports reject operations, and the
 * audit destination is explicitly unconfigured (release blocker). The chat
 * shell will show a clear "not configured" error state instead of silently
 * falling back to mock or privileged behavior.
 */
export function createProductionEngine(): ConversationEngine {
  const identity: IdentityPort = unconfiguredIdentity();
  const knowledge: KnowledgePort = unconfiguredKnowledge();
  const ticket: TicketPort = unconfiguredTicket();
  return new ConversationEngine({
    identity,
    knowledge,
    ticket,
    operational: consoleOperationalLogger(),
    audit: unconfiguredAuditDestination(),
  });
}
