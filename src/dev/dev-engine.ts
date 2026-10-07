import { ConversationEngine } from '../services/conversation-engine';
import { MockIdentityProvider } from '../mocks/mock-identity';
import { MockTicketProvider } from '../mocks/mock-ticket';
import { MockKnowledgeProvider } from '../mocks/mock-knowledge';
import { InMemoryAuditLogger } from '../mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../mocks/console-operational-logger';

/**
 * Development composition: explicitly wires the fictional mocks so the
 * application foundation can be exercised locally. This module is only
 * loaded in dev mode (dynamic import in src/main.ts); the production
 * build prunes it because import.meta.env.DEV is statically false.
 */
export function createEngineWithMocks(): { engine: ConversationEngine; audit: InMemoryAuditLogger } {
  const audit = new InMemoryAuditLogger();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    ticket: new MockTicketProvider(),
    operational: consoleOperationalLogger(),
    audit,
  });
  return { engine, audit };
}
