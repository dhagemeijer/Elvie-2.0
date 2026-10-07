import { describe, expect, it } from 'vitest';

import type { KnowledgePort, KnowledgeSearchQuery, KnowledgeSearchResponse } from '../src/ports/knowledge';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';

const NO_RESULTS: KnowledgeSearchResponse = { results: [], outcome: 'no_results' };

class EmptyKnowledgeProvider implements KnowledgePort {
  async search(_query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
    return NO_RESULTS;
  }
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((message) => message.text).join('\n');
}

describe('temporary diagnostics (removed before review)', () => {
  it('dumps the recovery flow internals', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'timeout' });
    const audit = new InMemoryAuditLogger();
    const engine = new ConversationEngine({
      identity: new MockIdentityProvider(),
      knowledge: new EmptyKnowledgeProvider(),
      ticket: tickets,
      operational: consoleOperationalLogger(),
      audit,
    });
    await engine.start();
    const preview = text(await engine.handleEmployeeInput('printer print niet'));
    const stateAfterInput = engine.currentState;
    const first = text(await engine.handleEmployeeInput('versturen'));
    const stateAfterFirst = engine.currentState;
    const countAfterFirst = tickets.submitCallCount;
    tickets.resolveAsSubmitted('SIM-incident-0421');
    const recovered = text(await engine.handleEmployeeInput('versturen'));
    const stateAfterRecovery = engine.currentState;
    const countAfterRecovery = tickets.submitCallCount;
    const dump = JSON.stringify({
      preview: preview.slice(0, 400),
      stateAfterInput,
      first: first.slice(0, 400),
      stateAfterFirst,
      countAfterFirst,
      recovered: recovered.slice(0, 400),
      stateAfterRecovery,
      countAfterRecovery,
      drafts: tickets.submittedDrafts.length,
      auditEvents: audit.recordedEvents.map((event) => [
        event.action,
        event.outcome,
        event.reason ?? null,
        event.targetId ?? null,
      ]),
    });
    expect(dump).toBe('DIAGNOSTIC DUMP');
  });
});
