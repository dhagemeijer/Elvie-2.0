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

async function probe(word: string): Promise<unknown> {
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
  await engine.handleEmployeeInput('printer print niet');
  await engine.handleEmployeeInput('versturen');
  tickets.resolveAsSubmitted('SIM-incident-0421');
  const reply = text(await engine.handleEmployeeInput(word));
  return {
    word,
    reply: reply.slice(0, 200),
    state: engine.currentState,
    submitCalls: tickets.submitCallCount,
    auditEvents: audit.recordedEvents.map((event) => [event.action, event.outcome, event.reason ?? null]),
  };
}

describe('temporary diagnostics v2 (removed before review)', () => {
  it('probes status-check trigger words after an inconclusive submission', async () => {
    const results = [];
    results.push(await probe('status'));
    results.push(await probe('ja'));
    results.push(await probe('versturen'));
    results.push(await probe('controleer de status'));
    expect(JSON.stringify(results)).toBe('DIAGNOSTIC DUMP V2');
  });
});
