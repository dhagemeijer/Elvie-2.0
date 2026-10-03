import { describe, expect, it } from 'vitest';
import { MockIncidentProvider } from '../src/mocks/mock-incident';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';

describe('mock knowledge port', () => {
  it('returns fictional results for a matching query', async () => {
    const knowledge = new MockKnowledgeProvider();
    const results = await knowledge.search({ text: 'wachtwoord vergeten' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe('mock-kb-001');
    expect(results.every((item) => item.id.startsWith('mock-kb-'))).toBe(true);
  });

  it('returns an empty result for a non-matching query', async () => {
    const knowledge = new MockKnowledgeProvider();
    const results = await knowledge.search({ text: 'xyzzyplugh' });
    expect(results).toEqual([]);
  });
});

describe('mock incident port', () => {
  it('accepts a fictional mapped request and returns a reference', async () => {
    const incidents = new MockIncidentProvider();
    const result = await incidents.submit({
      summary: 'Test incident',
      description: 'Fictieve beschrijving',
      context: { locatie: 'Hoofdgebouw' },
    });
    expect(result.reference).toMatch(/^MOCK-INCIDENT-\d{4}$/);
    expect(incidents.submittedDrafts).toHaveLength(1);
    expect(incidents.submittedDrafts[0]?.summary).toBe('Test incident');
  });
});
