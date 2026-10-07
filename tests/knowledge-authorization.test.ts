import { describe, expect, it } from 'vitest';
import type { KnowledgeArticle, KnowledgePort, KnowledgeSearchQuery, KnowledgeSearchResponse } from '../src/ports/knowledge';
import { gateKnowledgeArticles } from '../src/domain/knowledge-ranking';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';

const NOW = '2026-10-07T09:00:00.000Z';

function makeArticle(id: string, overrides: Partial<KnowledgeArticle> = {}): KnowledgeArticle {
  return {
    id,
    title: 'Artikel ' + id,
    summary: 'Fictieve samenvatting.',
    steps: ['Stap 1'],
    sourceReference: 'KB-' + id.toUpperCase(),
    status: 'published',
    language: 'nl',
    minimumQualityMet: true,
    validFrom: '2024-01-01T00:00:00.000Z',
    keywords: ['Account'],
    subject: 'Account',
    authorizationDecision: { decidedBy: 'knowledge-adapter', decision: 'granted', policyId: 'policy-employee-kb' },
    audiencePolicy: { allowedAudiences: ['employee'] },
    ...overrides,
  };
}

const accountQuery: KnowledgeSearchQuery = {
  intent: 'request',
  subject: 'Account',
  symptom: undefined,
  requestedResource: undefined,
  keywords: ['Account'],
};

const noSignalQuery: KnowledgeSearchQuery = {
  intent: 'incident',
  subject: undefined,
  symptom: undefined,
  requestedResource: undefined,
  keywords: [],
};

/** Knowledge stub with a fixed response (engine-level tests). */
class FixedKnowledgeProvider implements KnowledgePort {
  constructor(private readonly response: KnowledgeSearchResponse) {}
  async search(_query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
    return this.response;
  }
}

function createEngine(knowledge: KnowledgePort): { engine: ConversationEngine; audit: InMemoryAuditLogger } {
  const audit = new InMemoryAuditLogger();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge,
    ticket: new MockTicketProvider(),
    operational: consoleOperationalLogger(),
    audit,
    now: () => NOW,
  });
  return { engine, audit };
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((message) => message.text).join('\n');
}

describe('knowledge authorization (BUILD_03.md v5.2 par. 3)', () => {
  it('fails closed: denied, inconclusive, absent and contradictory decisions are never offered', () => {
    const articles = [
      makeArticle('kb-denied', {
        authorizationDecision: { decidedBy: 'knowledge-adapter', decision: 'denied', reasonCategory: 'policy_denied' },
      }),
      makeArticle('kb-inconclusive', {
        authorizationDecision: {
          decidedBy: 'knowledge-adapter',
          decision: 'inconclusive',
          reasonCategory: 'policy_unavailable',
        },
      }),
      makeArticle('kb-contradictory', {
        authorizationDecision: { decidedBy: 'knowledge-adapter', decision: 'granted' },
      }),
      makeArticle('kb-granted', {}),
    ];
    const gated = gateKnowledgeArticles(articles, NOW, 'employee');
    expect(gated.map((article) => article.id)).toEqual(['kb-granted']);
  });

  it('mock returns full metadata without filtering up front (par. 3.4)', async () => {
    const denied = makeArticle('kb-denied', {
      authorizationDecision: { decidedBy: 'knowledge-adapter', decision: 'denied', reasonCategory: 'policy_denied' },
    });
    const provider = new MockKnowledgeProvider({ articles: [denied] });
    const response = await provider.search(accountQuery);
    expect(response.results.map((article) => article.id)).toEqual(['kb-denied']);
    // The decision is attached as structured metadata, not a boolean.
    expect(response.results[0]?.authorizationDecision.decision).toBe('denied');
  });

  it('computes the quality verdict adapter-side (title, source reference, at least one step)', async () => {
    const good = makeArticle('kb-good');
    const noSteps = makeArticle('kb-no-steps', { steps: [] });
    const provider = new MockKnowledgeProvider({ articles: [good, noSteps] });
    const response = await provider.search(accountQuery);
    const byId = new Map(response.results.map((article) => [article.id, article]));
    expect(byId.get('kb-good')?.minimumQualityMet).toBe(true);
    expect(byId.get('kb-no-steps')?.minimumQualityMet).toBe(false);
  });

  it('makes "only restricted results" indistinguishable from "no results" for the employee', async () => {
    const onlyDenied = createEngine(
      new FixedKnowledgeProvider({
        results: [
          makeArticle('kb-denied', {
            authorizationDecision: {
              decidedBy: 'knowledge-adapter',
              decision: 'denied',
              reasonCategory: 'policy_denied',
            },
          }),
        ],
        outcome: 'ok',
      }),
    );
    const empty = createEngine(new FixedKnowledgeProvider({ results: [], outcome: 'no_results' }));

    await onlyDenied.engine.start();
    const deniedReply = text(await onlyDenied.engine.handleEmployeeInput('printer print niet'));
    await empty.engine.start();
    const emptyReply = text(await empty.engine.handleEmployeeInput('printer print niet'));

    // Identical, fixed no-results text; no counts, no access hints.
    expect(deniedReply).toBe(emptyReply);
    expect(deniedReply).toContain('Ik heb hiervoor geen passende instructies gevonden.');
  });

  it('logs authorization categories internally with safe values only', async () => {
    const entries: { errorCategory?: string }[] = [];
    const operational = {
      log(entry: { errorCategory?: string }) {
        entries.push(entry);
      },
    };
    const audit = new InMemoryAuditLogger();
    const engine = new ConversationEngine({
      identity: new MockIdentityProvider(),
      knowledge: new FixedKnowledgeProvider({
        results: [
          makeArticle('kb-denied', {
            authorizationDecision: {
              decidedBy: 'knowledge-adapter',
              decision: 'denied',
              reasonCategory: 'policy_denied',
            },
          }),
          makeArticle('kb-inconclusive', {
            authorizationDecision: {
              decidedBy: 'knowledge-adapter',
              decision: 'inconclusive',
              reasonCategory: 'policy_unavailable',
            },
          }),
        ],
        outcome: 'ok',
      }),
      ticket: new MockTicketProvider(),
      operational,
      audit,
      now: () => NOW,
    });
    await engine.start();
    await engine.handleEmployeeInput('printer print niet');
    const categories = entries.map((entry) => entry.errorCategory);
    expect(categories).toContain('authorization_denied');
    expect(categories).toContain('authorization_inconclusive');
    expect(categories).toContain('no_results');
    // No article content or titles in the log entries.
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('Artikel kb-denied');
    expect(serialized).not.toContain('policy_denied');
  });

  it('never performs an unbounded search without a controlled signal', async () => {
    const provider = new MockKnowledgeProvider();
    const response = await provider.search(noSignalQuery);
    expect(response.results).toEqual([]);
    expect(response.outcome).toBe('no_results');
  });

  it('captures allowlist-only queries (no free text reaches the port)', async () => {
    const provider = new MockKnowledgeProvider();
    await provider.search(accountQuery);
    const captured = provider.capturedSearchQueries[0];
    expect(captured).toEqual(accountQuery);
    expect(JSON.stringify(captured)).not.toContain('undefined');
  });

  it('records the fixture decisions for negative tests', async () => {
    const provider = new MockKnowledgeProvider();
    await provider.search(accountQuery);
    const decisions = provider.lastAuthorizationDecisions;
    expect(decisions.length).toBeGreaterThan(0);
    const denied = decisions.find((decision) => decision.decision === 'denied');
    expect(denied?.reasonCategory).toBe('policy_denied');
    const inconclusive = decisions.find((decision) => decision.decision === 'inconclusive');
    expect(inconclusive?.reasonCategory).toBe('policy_unavailable');
    const contradictory = decisions.find(
      (decision) => decision.decision === 'granted' && decision.policyId === undefined,
    );
    expect(contradictory).toBeDefined();
  });

  it('simulates a dependency failure when the knowledge store is unavailable', async () => {
    const provider = new MockKnowledgeProvider({ mode: 'unavailable' });
    await expect(provider.search(accountQuery)).rejects.toThrow();
  });

  it('distinguishes a denied article from a dependency failure in behaviour and text', async () => {
    const deniedOnly = createEngine(
      new FixedKnowledgeProvider({
        results: [
          makeArticle('kb-denied', {
            authorizationDecision: {
              decidedBy: 'knowledge-adapter',
              decision: 'denied',
              reasonCategory: 'policy_denied',
            },
          }),
        ],
        outcome: 'ok',
      }),
    );
    const broken = createEngine(new FixedKnowledgeProvider({ results: [], outcome: 'unavailable' }));

    await deniedOnly.engine.start();
    const deniedReply = text(await deniedOnly.engine.handleEmployeeInput('printer print niet'));
    // A denied article is not an outage: the search succeeds and the
    // generic intake follows without any dependency text.
    expect(deniedReply).toContain('Ik heb hiervoor geen passende instructies gevonden.');
    expect(deniedReply).not.toContain('niet beschikbaar');
    expect(deniedOnly.engine.currentState).toBe('PREVIEW');

    await broken.engine.start();
    const brokenReply = text(await broken.engine.handleEmployeeInput('printer print niet'));
    expect(brokenReply).toContain('niet beschikbaar');
    expect(broken.engine.currentState).toBe('KNOWLEDGE_SEARCH');
  });
});
