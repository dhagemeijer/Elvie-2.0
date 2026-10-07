import { describe, expect, it } from 'vitest';
import type { KnowledgeArticle, KnowledgeSearchQuery } from '../src/ports/knowledge';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';

function makeArticle(id: string, overrides: Partial<KnowledgeArticle> = {}): KnowledgeArticle {
  return {
    id,
    title: 'Artikel ' + id,
    summary: 'Fictieve samenvatting.',
    steps: ['Stap 1'],
    status: 'published',
    language: 'nl-NL',
    minimumQualityMet: true,
    validFrom: '2024-01-01T00:00:00.000Z',
    keywords: ['Account'],
    subject: 'Account',
    authorization: { policyId: 'policy-employee-kb', allowedAudiences: ['employee'] },
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

describe('knowledge authorization (BUILD_03.md par. 4)', () => {
  it('never returns a denied article to the employee', async () => {
    const restricted = makeArticle('kb-restricted', {
      authorization: { policyId: 'policy-servicedesk-only', allowedAudiences: ['servicedesk'] },
    });
    const provider = new MockKnowledgeProvider({ articles: [restricted] });
    const response = await provider.search(accountQuery);
    expect(response.results).toEqual([]);
    expect(response.outcome).toBe('no_results');
  });

  it('makes "only denied results" indistinguishable from "no results"', async () => {
    const restricted = makeArticle('kb-restricted', {
      authorization: { policyId: 'policy-servicedesk-only', allowedAudiences: ['servicedesk'] },
    });
    const onlyDenied = new MockKnowledgeProvider({ articles: [restricted] });
    const empty = new MockKnowledgeProvider({ articles: [] });
    const onlyDeniedResponse = await onlyDenied.search(accountQuery);
    const emptyResponse = await empty.search(accountQuery);
    expect(JSON.stringify(onlyDeniedResponse)).toBe(JSON.stringify(emptyResponse));
  });

  it('fails closed on untrustworthy authorization metadata', async () => {
    const untrustworthy = makeArticle('kb-untrustworthy', {
      authorization: { policyId: '', allowedAudiences: ['employee'] },
    });
    const provider = new MockKnowledgeProvider({ articles: [untrustworthy] });
    const response = await provider.search(accountQuery);
    expect(response.results).toEqual([]);
    const decisions = provider.lastAuthorizationDecisions;
    const first = decisions[0];
    expect(first?.status).toBe('inconclusive');
    expect(
      first !== undefined && first.status === 'inconclusive'
        ? first.reasonCategory
        : undefined,
    ).toBe('untrustworthy_authorization_metadata');
  });

  it('logs authorization outcomes internally with safe categories only', async () => {
    const granted = makeArticle('kb-granted');
    const denied = makeArticle('kb-denied', {
      authorization: { policyId: 'policy-servicedesk-only', allowedAudiences: ['servicedesk'] },
    });
    const provider = new MockKnowledgeProvider({ articles: [granted, denied] });
    await provider.search(accountQuery);
    const decisions = provider.lastAuthorizationDecisions;
    expect(decisions).toHaveLength(2);
    const statuses = decisions.map((decision) => decision.status).sort();
    expect(statuses).toEqual(['denied', 'granted']);
    const grantedDecision = decisions.find((decision) => decision.status === 'granted');
    expect(grantedDecision?.status === 'granted' ? grantedDecision.policyId : undefined).toBe('policy-employee-kb');
    const deniedDecision = decisions.find((decision) => decision.status === 'denied');
    expect(deniedDecision?.status === 'denied' ? deniedDecision.reasonCategory : undefined).toBe(
      'audience_not_allowed',
    );
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

  it('simulates a dependency failure when the knowledge store is unavailable', async () => {
    const provider = new MockKnowledgeProvider({ mode: 'unavailable' });
    await expect(provider.search(accountQuery)).rejects.toThrow();
  });
});
