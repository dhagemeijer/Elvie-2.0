import { describe, expect, it } from 'vitest';
import type { KnowledgeArticle } from '../src/ports/knowledge';
import { gateKnowledgeArticles, rankKnowledgeArticles } from '../src/domain/knowledge-ranking';

const NOW = '2026-01-15T12:00:00.000Z';

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
    keywords: [],
    authorization: { policyId: 'policy-employee-kb', allowedAudiences: ['employee'] },
    ...overrides,
  };
}

describe('knowledge gating (BUILD_03.md par. 7)', () => {
  it('keeps valid published articles', () => {
    const article = makeArticle('kb-ok');
    expect(gateKnowledgeArticles([article], NOW)).toEqual([article]);
  });

  it('gates out draft, archived, low-quality, expired, future and non-nl articles', () => {
    const articles = [
      makeArticle('kb-draft', { status: 'draft' }),
      makeArticle('kb-archived', { status: 'archived' }),
      makeArticle('kb-quality', { minimumQualityMet: false }),
      makeArticle('kb-expired', { validUntil: '2025-12-31T00:00:00.000Z' }),
      makeArticle('kb-future', { validFrom: '2100-01-01T00:00:00.000Z' }),
      makeArticle('kb-language', { language: 'en-US' } as unknown as Partial<KnowledgeArticle>),
      makeArticle('kb-valid', {}),
    ];
    const gated = gateKnowledgeArticles(articles, NOW);
    expect(gated.map((article) => article.id)).toEqual(['kb-valid']);
  });
});

describe('knowledge ranking (BUILD_03.md par. 7)', () => {
  const query = {
    intent: 'incident' as const,
    subject: 'laptop',
    symptom: 'no_connection',
    requestedResource: undefined,
    keywords: ['laptop'],
  };

  it('assigns the documented ranking rule ids', () => {
    const articles = [
      makeArticle('kb-subj', { subject: 'laptop', symptom: 'no_connection', keywords: ['laptop'] }),
      makeArticle('kb-symptom', { symptom: 'no_connection' }),
      makeArticle('kb-keyword', { keywords: ['laptop'] }),
    ];
    const ranked = rankKnowledgeArticles(articles, query);
    expect(ranked[0]?.matchRules).toEqual([
      'rank_subject_exact',
      'rank_symptom_match',
      'rank_keyword_match',
    ]);
    expect(ranked[1]?.matchRules).toEqual(['rank_symptom_match']);
    // kb-keyword is keyword-only with a single keyword overlap: below the
    // approved relevance threshold and therefore excluded.
    expect(ranked).toHaveLength(2);
  });

  it('applies the relevance threshold: unmatched articles are excluded', () => {
    const unmatched = makeArticle('kb-none', { subject: 'printer', symptom: 'not_working', keywords: ['printer'] });
    const matched = makeArticle('kb-some', { subject: 'laptop' });
    const ranked = rankKnowledgeArticles([unmatched, matched], query);
    expect(ranked.map((entry) => entry.article.id)).toEqual(['kb-some']);
  });

  it('excludes a keyword-only match with a single keyword overlap (approved v5.2 threshold)', () => {
    const keywordOnlySingle = makeArticle('kb-keyword-single', { keywords: ['laptop'] });
    const ranked = rankKnowledgeArticles([keywordOnlySingle], query);
    expect(ranked).toEqual([]);
  });

  it('keeps a keyword-only match with two or more overlapping keywords', () => {
    const doubleKeywordQuery = {
      intent: 'incident' as const,
      subject: undefined,
      symptom: undefined,
      requestedResource: undefined,
      keywords: ['laptop', 'no_connection'],
    };
    const keywordOnlyDouble = makeArticle('kb-keyword-double', { keywords: ['laptop', 'no_connection'] });
    const ranked = rankKnowledgeArticles([keywordOnlyDouble], doubleKeywordQuery);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.matchRules).toEqual(['rank_keyword_match']);
  });

  it('keeps a single subject match without any keyword overlap', () => {
    const subjectOnly = makeArticle('kb-subject-only', { subject: 'laptop' });
    const ranked = rankKnowledgeArticles([subjectOnly], query);
    expect(ranked.map((entry) => entry.article.id)).toEqual(['kb-subject-only']);
  });

  it('keeps a keyword-only match combined with a further match rule', () => {
    const keywordPlusSubject = makeArticle('kb-keyword-subject', { subject: 'laptop', keywords: ['laptop'] });
    const ranked = rankKnowledgeArticles([keywordPlusSubject], query);
    expect(ranked[0]?.matchRules).toEqual(['rank_subject_exact', 'rank_keyword_match']);
  });

  it('ranks subject+symptom above keyword matches and excludes single keyword-only matches', () => {
    const keywordOnly = makeArticle('a-keyword', { keywords: ['laptop'] });
    const keywordPlusSymptom = makeArticle('m-keyword-symptom', { symptom: 'no_connection', keywords: ['laptop'] });
    const subjectSymptom = makeArticle('z-subject-symptom', { subject: 'laptop', symptom: 'no_connection' });
    const ranked = rankKnowledgeArticles([keywordOnly, keywordPlusSymptom, subjectSymptom], query);
    expect(ranked.map((entry) => entry.article.id)).toEqual(['z-subject-symptom', 'm-keyword-symptom']);
  });

  it('breaks ties deterministically on the article id', () => {
    const b = makeArticle('kb-b', { subject: 'laptop' });
    const a = makeArticle('kb-a', { subject: 'laptop' });
    const ranked = rankKnowledgeArticles([b, a], query);
    expect(ranked.map((entry) => entry.article.id)).toEqual(['kb-a', 'kb-b']);
  });

  it('is deterministic: identical input produces identical output', () => {
    const articles = [
      makeArticle('kb-1', { subject: 'laptop', symptom: 'no_connection' }),
      makeArticle('kb-2', { keywords: ['laptop'] }),
      makeArticle('kb-3', { symptom: 'no_connection', keywords: ['laptop'] }),
    ];
    const first = rankKnowledgeArticles(articles, query);
    const second = rankKnowledgeArticles(articles, query);
    expect(first).toEqual(second);
    expect(first.map((entry) => entry.article.id)).toEqual(['kb-1', 'kb-3']);
  });

  it('applies the resource match rule for requests', () => {
    const requestQuery = {
      intent: 'request' as const,
      subject: undefined,
      symptom: undefined,
      requestedResource: 'Mailbox',
      keywords: ['Mailbox'],
    };
    const resource = makeArticle('kb-resource', { requestedResource: 'Mailbox', keywords: ['Mailbox'] });
    const ranked = rankKnowledgeArticles([resource], requestQuery);
    expect(ranked[0]?.matchRules).toEqual(['rank_resource_match', 'rank_keyword_match']);
  });
});
