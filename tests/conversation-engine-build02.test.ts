import { describe, expect, it } from 'vitest';
import type { KnowledgePort, KnowledgeSearchQuery, KnowledgeSearchResponse } from '../src/ports/knowledge';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import type { OperationalLogEntry, OperationalLoggerPort } from '../src/ports/logging';

/** Test double that captures operational entries for safe-logging assertions. */
class CapturingOperationalLogger implements OperationalLoggerPort {
  readonly entries: OperationalLogEntry[] = [];
  log(entry: OperationalLogEntry): void {
    this.entries.push(entry);
  }
}

/** Knowledge stub that records every port call (phishing bypass assertion). */
class RecordingKnowledgeProvider implements KnowledgePort {
  readonly queries: KnowledgeSearchQuery[] = [];
  constructor(private readonly response: KnowledgeSearchResponse = { results: [], outcome: 'no_results' }) {}
  async search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
    this.queries.push(query);
    return this.response;
  }
}

function createTestEngine(): {
  engine: ConversationEngine;
  operational: CapturingOperationalLogger;
  audit: InMemoryAuditLogger;
  tickets: MockTicketProvider;
} {
  const operational = new CapturingOperationalLogger();
  const audit = new InMemoryAuditLogger();
  const tickets = new MockTicketProvider();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    ticket: tickets,
    operational,
    audit,
  });
  return { engine, operational, audit, tickets };
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((message) => message.text).join('\n');
}

describe('ConversationEngine Build 02 integration', () => {
  it('asks for the missing device once and proceeds when it is known (never ask twice)', async () => {
    const { engine } = createTestEngine();
    await engine.start();
    const first = await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    expect(text(first)).toContain('Op welk apparaat');
    const second = await engine.handleEmployeeInput('op mijn laptop');
    expect(text(second)).not.toContain('Op welk apparaat');
    // Sufficient understanding continues to the Build 03 knowledge flow:
    expect(text(second)).toContain('opgelost');
  });

  it('never asks for an already-known device (wifi laptop sentence)', async () => {
    const { engine } = createTestEngine();
    await engine.start();
    const reply = await engine.handleEmployeeInput(
      'Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.',
    );
    expect(text(reply)).not.toContain('Op welk apparaat');
    expect(text(reply)).toContain('opgelost');
  });

  it('keeps unknown input in UNDERSTAND and recovers on the next message', async () => {
    const { engine } = createTestEngine();
    await engine.start();
    const unknown = await engine.handleEmployeeInput('Kun je me helpen?');
    expect(text(unknown)).toContain('begrijp');
    const next = await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    expect(text(next)).toContain('Op welk apparaat');
  });

  it('routes a phishing report conservatively, bypassing the knowledge port', async () => {
    const operational = new CapturingOperationalLogger();
    const audit = new InMemoryAuditLogger();
    const tickets = new MockTicketProvider();
    const knowledge = new RecordingKnowledgeProvider();
    const engine = new ConversationEngine({
      identity: new MockIdentityProvider(),
      knowledge,
      ticket: tickets,
      operational,
      audit,
    });
    await engine.start();
    const reply = await engine.handleEmployeeInput(
      'Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.',
    );
    // Phishing NEVER consults the knowledge port (port-call assertion).
    expect(knowledge.queries).toHaveLength(0);
    expect(text(reply)).toContain('onveilige situatie');
    expect(tickets.submittedDrafts).toHaveLength(0);
    expect(audit.recordedEvents.some((event) => event.action === 'submit_ticket')).toBe(false);
  });

  it('never logs raw employee input or sensitive values (safe logging)', async () => {
    const { engine, operational, audit } = createTestEngine();
    await engine.start();
    await engine.handleEmployeeInput('Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.');
    await engine.handleEmployeeInput('mijn BSN is 123456789 en het print niet');
    const allEmitted = JSON.stringify(operational.entries) + JSON.stringify(audit.recordedEvents);
    const lowered = allEmitted.toLowerCase();
    for (const fragment of ['wifi', 'kantoor', 'outlook', '123456789', 'wachtwoord ingevuld', 'geklikt']) {
      expect(lowered).not.toContain(fragment);
    }
    // The sensitive value was blocked with a safe warning:
    expect(operational.entries.some((entry) => entry.errorCategory === 'pii-guard')).toBe(true);
  });
});
