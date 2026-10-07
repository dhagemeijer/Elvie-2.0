import { describe, expect, it } from 'vitest';

import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { makeSubmissionKey, type TicketDraft, type TicketStatusResult } from '../src/ports/ticket';

function draft(category: TicketDraft['category'], key = makeSubmissionKey('session-1', 1)): TicketDraft {
  return {
    category,
    summary: 'Fictieve samenvatting',
    description: 'Fictieve beschrijving (simulatie).',
    context: { subject: 'Account' },
    submissionKey: key,
  };
}

describe('mock knowledge provider', () => {
  it('returns full metadata for matching articles, including restricted ones (no prefiltering)', async () => {
    const provider = new MockKnowledgeProvider();
    const response = await provider.search({
      intent: 'request',
      subject: 'Account',
      requestedResource: 'Account',
      keywords: ['Account'],
    });

    expect(response.outcome).toBe('ok');
    expect(response.results.length).toBeGreaterThan(0);
    const ids = response.results.map((article) => article.id);
    expect(ids).toContain('mock-kb-001');
    // The mock returns full metadata without filtering up front (par. 3.4):
    // restricted and untrustworthy items stay in the response; the engine
    // gates them fail-closed.
    expect(ids).toContain('mock-kb-006');
    expect(ids).toContain('mock-kb-010');
    expect(ids).toContain('mock-kb-013');
    // Non-matching fixtures are simply not search results.
    expect(ids).not.toContain('mock-kb-007');
    expect(ids).not.toContain('mock-kb-002');
    expect(response.results.every((article) => article.language === 'nl')).toBe(true);
  });

  it('returns full metadata for draft, expired, low-quality and future articles (no prefiltering)', async () => {
    const provider = new MockKnowledgeProvider();
    const response = await provider.search({ intent: 'incident', subject: 'laptop', keywords: ['laptop'] });
    const ids = response.results.map((article) => article.id);
    expect(ids).toContain('mock-kb-002');
    expect(ids).toContain('mock-kb-008');
    expect(ids).toContain('mock-kb-009');
    expect(ids).toContain('mock-kb-012');
    expect(ids).toContain('mock-kb-014');
    const byId = new Map(response.results.map((article) => [article.id, article]));
    expect(byId.get('mock-kb-008')?.validUntil).toBe('2025-01-01T00:00:00.000Z');
    expect(byId.get('mock-kb-012')?.validFrom).toBe('2100-01-01T00:00:00.000Z');
    // Adapter-computed quality: no steps means below the threshold.
    expect(byId.get('mock-kb-009')?.minimumQualityMet).toBe(false);
    expect(byId.get('mock-kb-002')?.minimumQualityMet).toBe(true);
    // The defense-in-depth audience mismatch is granted server-side.
    expect(byId.get('mock-kb-014')?.audiencePolicy.allowedAudiences).toEqual(['servicedesk']);
  });

  it('returns no_results when no controlled signal is provided', async () => {    const provider = new MockKnowledgeProvider();
    const response = await provider.search({
      intent: 'request',
      keywords: [],
    });

    expect(response.outcome).toBe('no_results');
    expect(response.results).toHaveLength(0);
  });

  it('records the structured fixture authorization decisions for negative tests', async () => {
    const provider = new MockKnowledgeProvider();
    await provider.search({ intent: 'incident', subject: 'Account', keywords: ['Account'] });

    const decisions = provider.lastAuthorizationDecisions;
    expect(decisions.length).toBeGreaterThan(0);
    const denied = decisions.find((decision) => decision.decision === 'denied');
    expect(denied).toBeDefined();
    expect(denied?.reasonCategory).toBe('policy_denied');
    const inconclusive = decisions.find((decision) => decision.decision === 'inconclusive');
    expect(inconclusive).toBeDefined();
    expect(inconclusive?.reasonCategory).toBe('policy_unavailable');
    const contradictory = decisions.find(
      (decision) => decision.decision === 'granted' && decision.policyId === undefined,
    );
    expect(contradictory).toBeDefined();
  });

  it('captures search queries for negative tests', async () => {
    const provider = new MockKnowledgeProvider();
    await provider.search({ intent: 'incident', subject: 'Account', keywords: ['Account'] });

    const queries = provider.capturedSearchQueries;
    expect(queries).toHaveLength(1);
    expect(queries[0]?.subject).toBe('Account');
  });

  it('throws in unavailable mode to simulate a dependency failure', async () => {
    const provider = new MockKnowledgeProvider({ mode: 'unavailable' });

    await expect(
      provider.search({ intent: 'incident', subject: 'Account', keywords: ['Account'] }),
    ).rejects.toThrow();
  });
});

describe('mock ticket provider (v5.2/v5.2.1 kind contract)', () => {
  it('submits a draft with a simulation reference per category', async () => {
    const provider = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    const result = await provider.submit(draft('incident', key));

    expect(result.kind).toBe('submitted');
    if (result.kind === 'submitted') {
      expect(result.reference).toMatch(/^SIM-incident-\d{4}$/);
      expect(result.submissionKey.value).toBe(key.value);
    }
    expect(provider.submittedDrafts).toHaveLength(1);
    expect(provider.submittedDrafts[0]?.category).toBe('incident');
  });

  it('is idempotent per submission key', async () => {
    const provider = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);

    const first = await provider.submit(draft('incident', key));
    const second = await provider.submit(draft('incident', key));

    expect(first.kind).toBe('submitted');
    expect(second.kind).toBe('submitted');
    if (first.kind === 'submitted' && second.kind === 'submitted') {
      expect(second.reference).toBe(first.reference);
    }
    expect(provider.submitCallCount).toBe(2);
    expect(provider.submittedDrafts).toHaveLength(1);
  });

  it('uses distinct references for distinct submission keys', async () => {
    const provider = new MockTicketProvider();

    const first = await provider.submit(draft('request', makeSubmissionKey('session-1', 1)));
    const second = await provider.submit(draft('request', makeSubmissionKey('session-1', 2)));

    if (first.kind === 'submitted' && second.kind === 'submitted') {
      expect(second.reference).not.toBe(first.reference);
      expect(second.reference).toMatch(/^SIM-request-\d{4}$/);
    }
  });

  it('reports a submitted status with the reference for an existing key', async () => {
    const provider = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    const result = await provider.submit(draft('security', key));

    const status: TicketStatusResult = await provider.getStatus(key);
    expect(status.kind).toBe('submitted');
    if (status.kind === 'submitted' && result.kind === 'submitted') {
      expect(status.reference).toBe(result.reference);
      expect(status.reference).toMatch(/^SIM-security-\d{4}$/);
      expect(status.submissionKey.value).toBe(key.value);
    }
  });

  it('reports an unknown status without any reference for an unknown key', async () => {
    const provider = new MockTicketProvider();
    const status = await provider.getStatus(makeSubmissionKey('session-unknown', 1));

    expect(status.kind).toBe('unknown');
    if (status.kind === 'unknown') {
      expect(status.submissionKey.value).toBe('session-unknown#1');
      expect('reference' in status).toBe(false);
    }
  });

  it('reports failed without a reference for a rejected submission', async () => {
    const provider = new MockTicketProvider();
    provider.setFailureMode('fail_rejected');

    const result = await provider.submit(draft('incident'));

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reasonCategory).toBe('rejected');
    }
    expect(provider.submittedDrafts).toHaveLength(0);
  });

  it('simulates a timeout and a transport failure as kind unknown', async () => {
    for (const failureMode of ['timeout', 'transport'] as const) {
      const provider = new MockTicketProvider();
      provider.setFailureMode(failureMode);
      const result = await provider.submit(draft('incident'));
      expect(result.kind).toBe('unknown');
      if (result.kind === 'unknown') {
        expect(result.reasonCategory).toBe(failureMode);
        expect('reference' in result).toBe(false);
      }
    }
  });

  it('resolves the last submission as submitted for recovery tests', async () => {
    const provider = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    provider.setFailureMode('timeout');
    await provider.submit(draft('incident', key));

    provider.setFailureMode('success');
    provider.resolveAsSubmitted('SIM-incident-0421');
    const status = await provider.getStatus(key);
    expect(status.kind).toBe('submitted');
    if (status.kind === 'submitted') {
      expect(status.reference).toBe('SIM-incident-0421');
    }
  });
});
