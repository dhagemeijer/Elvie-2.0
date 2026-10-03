import type { IdentityPort } from '../ports/identity';
import type { IncidentPort } from '../ports/incident';
import type { KnowledgePort } from '../ports/knowledge';
import { ConversationEngine } from '../services/conversation-engine';
import { consoleOperationalLogger } from '../mocks/console-operational-logger';
import { unconfiguredIdentity } from '../ports/identity';
import { unconfiguredIncident } from '../ports/incident';
import { unconfiguredKnowledge } from '../ports/knowledge';

/**
 * Production composition for Build 01: every external port is fail-closed.
 * Identity rejects access, knowledge/incident reject operations. The chat
 * shell will show a clear "not configured" error state instead of silently
 * falling back to mock or privileged behavior.
 */
export function createProductionEngine(): ConversationEngine {
  const identity: IdentityPort = unconfiguredIdentity();
  const knowledge: KnowledgePort = unconfiguredKnowledge();
  const incidents: IncidentPort = unconfiguredIncident();
  return new ConversationEngine({
    identity,
    knowledge,
    incidents,
    operational: consoleOperationalLogger(),
    audit: {
      // Unconfigured audit destination: dropping events silently would hide
      // accountability gaps. For Build 01 we surface failures on the
      // operational channel; the real destination arrives in Build 08.
      record(event) {
        // eslint-disable-next-line no-console -- unconfigured audit destination, surfaced for now
        console.warn(`[audit:unconfigured-destination] ${event.eventType} ${event.action} ${event.outcome}`);
      },
    },
  });
}
