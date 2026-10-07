import { describe, expect, it } from 'vitest';

import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { makeSubmissionKey, type TicketDraft } from '../src/ports/ticket';

function draft(category: TicketDraft['category']): TicketDraft {
  return {
    category,
    summary: 'Fictieve samenvatting',
    description: 'Fictieve beschrijving (simulatie).',
    context: { subject: 'Account' },
  };
}

describe('mock knowledge provider', () => {
  it('returns only authorized, published articles for an allowed query', async () => {
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
    expect(ids).not.toContain('mock-kb-006');
    expect(ids).not.toContain('mock-kb-010');
    expect(response.results.every((article) => article.status === 'published')).toBe(true);
    expect(response.results.every((article) => article.language === 'nl-NL')).toBe(true);
  });

  it('returns no_results when no controlled signal is provided', async () => {
    const provider = new MockKnowledgeProvider();
    const response = await provider.search({
      intent: 'request',
      keywords: [],
    });

    expect(response.outcome).toBe('no_results');
    expect(response.results).toHaveLength(0);
  });

  it('records authorization decisions for negative tests', async () => {
    const provider = new MockKnowledgeProvider();
    await provider.search({ intent: 'incident', subject: 'Account', keywords: ['Account'] });

    const decisions = provider.lastAuthorizationDecisions;
    expect(decisions.length).toBeGreaterThan(0);
    const denied = decisions.find((decision) => decision.status === 'denied');
    expect(denied).toBeDefined();
    if (denied && denied.status === 'denied') {
      expect(denied.reasonCategory).toBe('audience_not_allowed');
    }
    const inconclusive = decisions.find((decision) => decision.status === 'inconclusive');
    expect(inconclusive).toBeDefined();
    if (inconclusive && inconclusive.status === 'inconclusive') {
      expect(inconclusive.reasonCategory).toBe('untrustworthy_authorization_metadata');
    }
  });

  it('captures search queries for negative tests', async () => {
    const provider = new MockKnowledgeProvider();
    await provider.search({ intent: 'incident', subject: 'Account', keywords: ['Account'] });

    const queries = provider.capturedSearchQueries;
    expect(queries).toHaveLength(1);
    expect(queries[0].subject).toBe('Account');
  });

  it('throws in unavailable mode to simulate a dependency failure', async () => {
    const provider = new MockKnowledgeProvider({ mode: 'unavailable' });

    await expect(
      provider.search({ intent: 'incident', subject: 'Account', keywords: ['Account'] }),
    ).rejects.toThrow();
  });
});

describe('mock ticket provider', () => {
  it('submits a draft with a simulation reference per category', async () => {
    const provider = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    const result = await provider.submit(draft('incident'), key);

    expect(result.status).toBe('submitted');
    if (result.status === 'submitted') {
      expect(result.reference).toMatch(/^SIM-incident-\d{4}$/);
      expect(result.submissionKey).toBe(key.value);
    }
    expect(provider.submittedDrafts).toHaveLength(1);
    expect(provider.submittedDrafts[0].category).toBe('incident');
  });

  it('is idempotent per submission key', async () => {
    const provider = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);

    const first = await provider.submit(draft('incident'), key);
    const second = await provider.submit(draft('incident'), key);

    expect(first.status).toBe('submitted');
    expect(second.status).toBe('submitted');
    if (first.status === 'submitted' && second.status === 'submitted') {
      expect(second.reference).toBe(first.reference);
    }
    expect(provider.submitCallCount).toBe(2);
    expect(provider.submittedDrafts).toHaveLength(1);
  });

  it('uses distinct references for distinct submission keys', async () => {
    const provider = new MockTicketProvider();

    const first = await provider.submit(draft('request'), makeSubmissionKey('session-1', 1));
    const second = await provider.submit(draft('request'), makeSubmissionKey('session-1', 2));

    if (first.status === 'submitted' && second.status === 'submitted') {
      expect(second.reference).not.toBe(first.reference);
      expect(second.reference).toMatch(/^SIM-request-\d{4}$/);
    }
  });

  it('reports submitted status for an existing submission key', async () => {
    const provider = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    const result = await provider.submit(draft('security'), key);

    const status = await provider.getStatus(key);
    expect(status.status).toBe('submitted');
    if (status.status === 'submitted' && result.status === 'submitted') {
      expect(status.reference).toBe(result.reference);
      expect(status.reference).toMatch(/^SIM-security-\d{4}$/);
    }
  });

  it('reports inconclusive status for an unknown submission key', async () => {
    const provider = new MockTicketProvider();
    const status = await provider.getStatus(makeSubmissionKey('session-unknown', 1));

    expect(status.status).toBe('inconclusive');
    if (status.status === 'inconclusive') {
      expect(status.submissionKey).toBe('session-unknown#1');
    }
  });

  it('reports failed without a reference for a rejected submission', async () => {
    const provider = new MockTicketProvider();
    provider.setFailureMode('fail_rejected');

    const result = await provider.submit(draft('incident'), makeSubmissionKey('session-1', 1));

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reasonCategory).toBe('rejected');
    }
    expect(provider.submittedDrafts).toHaveLength(0);
  });

  it('simulates a timeout via a thrown transport error', async () => {
    const provider = new MockTicketProvider();
    provider.setFailureMode('timeout');

    await expect(
      provider.submit(draft('incident'), makeSubmissionKey('session-1', 1)),
    ).rejects.toThrow();
  });

  it('resolves the last submission as submitted for recovery tests', async () => {
    const provider = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    provider.setFailureMode('timeout');
    await provider.submit(draft('incident'), key).catch(() => undefined);

    provider.setFailureMode('success');
    provider.resolveAsSubmitted('SIM-incident-0421');
    const status = await provider.getStatus(key);
    expect(status.status).toBe('submitted');
    if (status.status === 'submitted') {
      expect(status.reference).toBe('SIM-incident-0421');
    }
  });
});
