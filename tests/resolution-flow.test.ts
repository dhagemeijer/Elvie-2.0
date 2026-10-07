import { describe, expect, it } from 'vitest';
import type { KnowledgeArticle, KnowledgePort, KnowledgeSearchQuery, KnowledgeSearchResponse } from '../src/ports/knowledge';
import { ConversationEngine, MAX_KNOWLEDGE_ARTICLES_PER_SERIES } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import type { OperationalLogEntry, OperationalLoggerPort } from '../src/ports/logging';

const FIXED_NOW = () => '2026-10-07T09:00:00.000Z';

/** Knowledge stub that records every call (port-call assertions). */
class RecordingKnowledgeProvider implements KnowledgePort {
  readonly queries: KnowledgeSearchQuery[] = [];
  constructor(private readonly response: KnowledgeSearchResponse = { results: [], outcome: 'no_results' }) {}
  async search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
    this.queries.push(query);
    return this.response;
  }
}

/** Knowledge stub that fails the first N searches, then succeeds. */
class FlakyKnowledgeProvider implements KnowledgePort {
  private calls = 0;
  constructor(
    private readonly failures: number,
    private readonly successResponse: KnowledgeSearchResponse,
  ) {}
  async search(): Promise<KnowledgeSearchResponse> {
    this.calls += 1;
    if (this.calls <= this.failures) {
      throw new Error('Simulated knowledge dependency failure');
    }
    return this.successResponse;
  }
}

class CapturingOperationalLogger implements OperationalLoggerPort {
  readonly entries: OperationalLogEntry[] = [];
  log(entry: OperationalLogEntry): void {
    this.entries.push(entry);
  }
}

function laptopArticle(id: string): KnowledgeArticle {
  return {
    id,
    title: 'Oplossing ' + id,
    summary: 'Fictieve instructie voor laptop-problemen.',
    steps: ['Stap 1', 'Stap 2'],
    sourceReference: 'KB-' + id.toUpperCase(),
    status: 'published',
    language: 'nl',
    minimumQualityMet: true,
    validFrom: '2024-01-01T00:00:00.000Z',
    keywords: ['laptop'],
    subject: 'laptop',
    symptom: 'no_connection',
    authorizationDecision: { decidedBy: 'knowledge-adapter', decision: 'granted', policyId: 'policy-employee-kb' },
    audiencePolicy: { allowedAudiences: ['employee'] },
  };
}

function createEngine(
  knowledge: KnowledgePort,
  tickets = new MockTicketProvider(),
): { engine: ConversationEngine; audit: InMemoryAuditLogger; operational: CapturingOperationalLogger; tickets: MockTicketProvider } {
  const audit = new InMemoryAuditLogger();
  const operational = new CapturingOperationalLogger();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge,
    ticket: tickets,
    operational,
    audit,
    now: FIXED_NOW,
  });
  return { engine, audit, operational, tickets };
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((message) => message.text).join('\n');
}

async function startLaptopScenario(engine: ConversationEngine): Promise<string> {
  await engine.start();
  const reply = await engine.handleEmployeeInput(
    'Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.',
  );
  return text(reply);
}

describe('guided resolution flow (BUILD_03.md v5.2 par. 7)', () => {
  it('offers a ranked article with the fixed presentation format and resolves to DONE after explicit confirmation', async () => {
    const knowledge = new RecordingKnowledgeProvider({
      results: [laptopArticle('kb-vpn')],
      outcome: 'ok',
    });
    const { engine } = createEngine(knowledge);
    const first = await startLaptopScenario(engine);
    expect(first).toContain('Oplossing kb-vpn');
    // Fixed presentation format (par. 6): title, steps, source citation.
    expect(first).toContain('Stappen:');
    expect(first).toContain('Bron: TOPdesk Kennisbank — KB-KB-VPN');
    // Fixed three-way question (par. 7).
    expect(first).toContain("Lost dit je probleem op? Antwoord 'opgelost', 'niet opgelost' of 'onduidelijk'.");
    const resolved = await engine.handleEmployeeInput('opgelost');
    expect(text(resolved)).toContain('Fijn');
    expect(engine.currentState).toBe('DONE');
  });

  it('offers at most three distinct articles and then continues to the intake', async () => {
    const articles = [laptopArticle('kb-1'), laptopArticle('kb-2'), laptopArticle('kb-3'), laptopArticle('kb-4')];
    const knowledge = new RecordingKnowledgeProvider({ results: articles, outcome: 'ok' });
    const { engine } = createEngine(knowledge);
    const first = await startLaptopScenario(engine);
    expect(first).toContain('Oplossing kb-1');
    const second = text(await engine.handleEmployeeInput('niet opgelost'));
    expect(second).toContain('Oplossing kb-2');
    const third = text(await engine.handleEmployeeInput('nee'));
    expect(third).toContain('Oplossing kb-3');
    expect(third).not.toContain('Oplossing kb-4');
    const intake = text(await engine.handleEmployeeInput('helpt niet'));
    expect(intake).not.toContain('Oplossing kb-4');
    expect(intake).toContain('vastleggen');
    expect(intake).toContain('simulatie');
  });

  it('treats "onduidelijk" as clarification, never as automatic rejection', async () => {
    const knowledge = new RecordingKnowledgeProvider({
      results: [laptopArticle('kb-vpn')],
      outcome: 'ok',
    });
    const { engine } = createEngine(knowledge);
    await startLaptopScenario(engine);
    const clarify = text(await engine.handleEmployeeInput('onduidelijk'));
    expect(clarify).toContain('onduidelijk aan deze instructies');
    expect(engine.currentState).toBe('KNOWLEDGE_SEARCH');
    const resolved = text(await engine.handleEmployeeInput('opgelost'));
    expect(resolved).toContain('Fijn');
    expect(engine.currentState).toBe('DONE');
  });

  it('moves on deterministically after repeated unclear answers (no infinite loop)', async () => {
    const articles = [laptopArticle('kb-1'), laptopArticle('kb-2')];
    const knowledge = new RecordingKnowledgeProvider({ results: articles, outcome: 'ok' });
    const { engine } = createEngine(knowledge);
    await startLaptopScenario(engine);
    await engine.handleEmployeeInput('onduidelijk');
    const second = text(await engine.handleEmployeeInput('weet niet'));
    expect(second).toContain('Oplossing kb-2');
  });

  it('routes to the generic intake when no article matches', async () => {
    const knowledge = new RecordingKnowledgeProvider();
    const { engine } = createEngine(knowledge);
    const reply = await startLaptopScenario(engine);
    expect(reply).toContain('Ik heb hiervoor geen passende instructies gevonden.');
    expect(reply).toContain('Bevestig om de simulatie af te ronden');
    // Never knowingly ask twice: symptom and device are already known.
    expect(reply).not.toContain('Wat gebeurt er precies?');
    expect(reply).not.toContain('Op welk apparaat');
    expect(engine.currentState).toBe('PREVIEW');
  });

  it('never interprets input after a search failure as resolution feedback', async () => {
    const knowledge = new FlakyKnowledgeProvider(1, { results: [laptopArticle('kb-vpn')], outcome: 'ok' });
    const { engine } = createEngine(knowledge);
    const first = await startLaptopScenario(engine);
    expect(first).toContain('niet beschikbaar');
    // 'opgelost' after a search failure must NOT resolve anything.
    const stillFailed = text(await engine.handleEmployeeInput('opgelost'));
    expect(stillFailed).not.toContain('Fijn');
    expect(stillFailed).toContain('opnieuw');
    expect(engine.currentState).toBe('KNOWLEDGE_SEARCH');
    const retry = text(await engine.handleEmployeeInput('opnieuw'));
    expect(retry).toContain('Oplossing kb-vpn');
    const resolved = text(await engine.handleEmployeeInput('opgelost'));
    expect(resolved).toContain('Fijn');
    expect(engine.currentState).toBe('DONE');
  });

  it('routes from a dependency failure directly to the intake on request', async () => {
    const knowledge = new FlakyKnowledgeProvider(99, { results: [], outcome: 'ok' });
    const { engine } = createEngine(knowledge);
    await startLaptopScenario(engine);
    const intake = text(await engine.handleEmployeeInput('melding'));
    expect(intake).toContain('vastleggen');
    expect(engine.currentState).toBe('PREVIEW');
  });
});

describe('intent-specific routes (BUILD_03.md v5.2 par. 9)', () => {
  it('never consults the knowledge port for a phishing report (security intake)', async () => {
    const knowledge = new RecordingKnowledgeProvider();
    const { engine, tickets } = createEngine(knowledge);
    await engine.start();
    const reply = text(
      await engine.handleEmployeeInput('Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.'),
    );
    expect(knowledge.queries).toHaveLength(0);
    // Approved phishing instruction (par. 9.1): no registration or sending
    // claim, explicit simulation.
    expect(reply).toContain('niet registreren of versturen');
    expect(reply).toContain('simulatie');
    expect(reply).toContain('beveiligingsmelding');
    expect(reply).not.toContain('kennis');
    expect(tickets.submittedDrafts).toHaveLength(0);

    const preview = text(await engine.handleEmployeeInput('klaar'));
    expect(preview).toContain('beveiligingsmelding');
    expect(preview).toContain('simulatie');
    expect(preview).toContain('niets naar TOPdesk verzonden');
    const submitted = text(await engine.handleEmployeeInput('versturen'));
    expect(submitted).toMatch(/SIM-security-\d{4}/);
    expect(tickets.submittedDrafts[0]?.category).toBe('security');
    expect(engine.currentState).toBe('CONFIRM');
  });

  it('registers a request as request, never silently as incident', async () => {
    const knowledge = new RecordingKnowledgeProvider();
    const { engine, tickets, audit } = createEngine(knowledge);
    await engine.start();
    const reply = text(await engine.handleEmployeeInput('Ik wil een nieuwe laptop.'));
    expect(knowledge.queries[0]?.intent).toBe('request');
    expect(reply).toContain('aanvraag');
    expect(reply).not.toContain('incident');
    const submitted = text(await engine.handleEmployeeInput('versturen'));
    expect(submitted).toMatch(/SIM-request-\d{4}/);
    expect(tickets.submittedDrafts[0]?.category).toBe('request');
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket');
    expect(event?.outcome).toBe('success');
    expect(event?.targetType).toBe('ticket');
  });

  it('keeps unknown intent in UNDERSTAND without any knowledge search', async () => {
    const knowledge = new RecordingKnowledgeProvider();
    const { engine } = createEngine(knowledge);
    await engine.start();
    const reply = text(await engine.handleEmployeeInput('Kun je me helpen?'));
    expect(reply).toContain('begrijp');
    expect(engine.currentState).toBe('UNDERSTAND');
    expect(knowledge.queries).toHaveLength(0);
  });

  it('never asks for information that is already reliably known (engine level)', async () => {
    const knowledge = new MockKnowledgeProvider({ articles: [] });
    const { engine } = createEngine(knowledge);
    await engine.start();
    const reply = text(await engine.handleEmployeeInput('printer print niet'));
    // Symptom and device are known from the Build 02 core: intake goes
    // straight to the preview without re-asking anything.
    expect(reply).not.toContain('Wat gebeurt er precies?');
    expect(reply).not.toContain('Op welk apparaat');
    expect(reply).toContain('Bevestig om de simulatie af te ronden');
    expect(engine.currentState).toBe('PREVIEW');
  });

  it('respects the configured maximum of distinct articles per series', () => {
    expect(MAX_KNOWLEDGE_ARTICLES_PER_SERIES).toBe(3);
  });
});
