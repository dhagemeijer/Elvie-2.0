/**
 * Deterministic knowledge gating and ranking (BUILD_03.md par. 7).
 *
 * Gating (publication, accessibility, validity, quality — with an
 * injected clock, never wall-clock time inside the domain):
 * - status must be published;
 * - language must be nl-NL;
 * - minimumQualityMet must be true;
 * - validFrom must be at or before now;
 * - validUntil must be absent or in the future.
 *
 * Ranking uses explainable match rules with stable ids:
 * - rank_subject_exact:   article subject equals the query subject;
 * - rank_symptom_match:   article symptom equals the query symptom;
 * - rank_resource_match:  article requestedResource equals the query value;
 * - rank_keyword_match:   at least one controlled keyword overlaps.
 *
 * Relevance threshold (approved BUILD_03.md v5.2): an article falls below
 * the threshold only when rank_keyword_match is its sole match rule AND
 * exactly one controlled keyword overlaps. Any subject, symptom or resource
 * match is relevant on its own, as is a keyword-only match with two or more
 * overlapping keywords.
 *
 * Ordering is a fixed, ordered tuple (subject, symptom, resource,
 * keyword), best first; equal tuples are ordered by article id ascending.
 * Everything is deterministic: identical input produces identical output.
 */
import type { KnowledgeArticle, KnowledgeSearchQuery } from '../ports/knowledge';

export type RankingRuleId = 'rank_subject_exact' | 'rank_symptom_match' | 'rank_resource_match' | 'rank_keyword_match';

/**
 * Minimum number of overlapping controlled keywords for a keyword-only
 * match to be relevant (approved BUILD_03.md v5.2: a single keyword overlap
 * without any further match rule falls below the threshold).
 */
export const MIN_RELEVANT_KEYWORD_OVERLAPS = 2;

export interface RankedKnowledgeArticle {
  readonly article: KnowledgeArticle;
  readonly matchRules: readonly RankingRuleId[];
}

/** Gate articles on publication, accessibility, validity and quality. */
export function gateKnowledgeArticles(
  articles: readonly KnowledgeArticle[],
  now: string,
): readonly KnowledgeArticle[] {
  return articles.filter(
    (article) =>
      article.status === 'published' &&
      article.language === 'nl-NL' &&
      article.minimumQualityMet === true &&
      article.validFrom <= now &&
      (article.validUntil === undefined || article.validUntil > now),
  );
}

function matchRulesFor(article: KnowledgeArticle, query: KnowledgeSearchQuery): RankingRuleId[] {
  const rules: RankingRuleId[] = [];
  if (query.subject !== undefined && article.subject === query.subject) {
    rules.push('rank_subject_exact');
  }
  if (query.symptom !== undefined && article.symptom === query.symptom) {
    rules.push('rank_symptom_match');
  }
  if (query.requestedResource !== undefined && article.requestedResource === query.requestedResource) {
    rules.push('rank_resource_match');
  }
  if (query.keywords.some((keyword) => article.keywords.includes(keyword))) {
    rules.push('rank_keyword_match');
  }
  return rules;
}

function keywordOverlapCount(article: KnowledgeArticle, query: KnowledgeSearchQuery): number {
  return query.keywords.filter((keyword) => article.keywords.includes(keyword)).length;
}

/**
 * Approved relevance threshold (BUILD_03.md v5.2): only rank_keyword_match
 * with exactly one overlapping keyword and no further match rule falls
 * below the threshold.
 */
function meetsRelevanceThreshold(
  article: KnowledgeArticle,
  query: KnowledgeSearchQuery,
  matchRules: readonly RankingRuleId[],
): boolean {
  const hasNonKeywordRule = matchRules.some((rule) => rule !== 'rank_keyword_match');
  if (hasNonKeywordRule) {
    return true;
  }
  return keywordOverlapCount(article, query) >= MIN_RELEVANT_KEYWORD_OVERLAPS;
}

/** Fixed relevance tuple: subject, symptom, resource, keyword. */
function relevanceKey(rules: readonly RankingRuleId[]): readonly [number, number, number, number] {
  return [
    rules.includes('rank_subject_exact') ? 1 : 0,
    rules.includes('rank_symptom_match') ? 1 : 0,
    rules.includes('rank_resource_match') ? 1 : 0,
    rules.includes('rank_keyword_match') ? 1 : 0,
  ];
}

function compareRelevance(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): number {
  for (let index = 0; index < 4; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }
  return 0;
}

/**
 * Rank gated articles against the query. Articles below the relevance
 * threshold are excluded; the remaining order is fully deterministic.
 */
export function rankKnowledgeArticles(
  gatedArticles: readonly KnowledgeArticle[],
  query: KnowledgeSearchQuery,
): readonly RankedKnowledgeArticle[] {
  const ranked: RankedKnowledgeArticle[] = [];
  for (const article of gatedArticles) {
    const matchRules = matchRulesFor(article, query);
    if (meetsRelevanceThreshold(article, query, matchRules)) {
      ranked.push({ article, matchRules });
    }
  }
  ranked.sort((left, right) => {
    const byRelevance = compareRelevance(relevanceKey(left.matchRules), relevanceKey(right.matchRules));
    if (byRelevance !== 0) {
      return byRelevance;
    }
    if (left.article.id < right.article.id) {
      return -1;
    }
    if (left.article.id > right.article.id) {
      return 1;
    }
    return 0;
  });
  return ranked;
}
