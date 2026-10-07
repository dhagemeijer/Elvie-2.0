/**
 * Deterministic knowledge gating and ranking (BUILD_03.md v5.2 par. 5).
 *
 * Gating BEFORE ranking, in a fixed order (with an injected clock, never
 * wall-clock time inside the domain):
 * - status must be published;
 * - the authorization decision must be a valid granted decision
 *   (decision 'granted' with a non-empty policyId) — fail-closed for
 *   denied, inconclusive, absent or contradictory decisions;
 * - defense-in-depth: the article audience policy must include the
 *   employee audience (independent of the adapter decision);
 * - language must be nl;
 * - validFrom must be at or before now, validUntil absent or in the future;
 * - the adapter-computed quality verdict must be true.
 *
 * Ranking uses explainable match rules with stable ids:
 * - rank_subject_exact:   article subject equals the query subject;
 * - rank_symptom_match:   article symptom equals the query symptom;
 * - rank_resource_match:  article requestedResource equals the query value;
 * - rank_keyword_match:   at least one controlled keyword overlaps.
 *
 * Relevance threshold (approved BUILD_03.md v5.2): an article falls below
 * the threshold only when rank_keyword_match is its sole match rule AND
 * exactly one controlled keyword overlaps. Any subject, symptom or
 * resource match is relevant on its own, as is a keyword-only match with
 * two or more overlapping keywords.
 *
 * Every ranked article carries an explanation record (rule ids plus the
 * matched terms); there is no reasoning trace. Ordering is a fixed,
 * ordered tuple (subject, symptom, resource, keyword), best first; equal
 * tuples are ordered by article id ascending. Everything is
 * deterministic: identical input produces identical output.
 */
import type { KnowledgeArticle, KnowledgeSearchQuery } from '../ports/knowledge';

export type RankingRuleId =
  | 'rank_subject_exact'
  | 'rank_symptom_match'
  | 'rank_resource_match'
  | 'rank_keyword_match';

/**
 * Minimum number of overlapping controlled keywords for a keyword-only
 * match to be relevant (approved BUILD_03.md v5.2: a single keyword overlap
 * without any further match rule falls below the threshold).
 */
export const MIN_RELEVANT_KEYWORD_OVERLAPS = 2;

/** One explanation record per matched rule (rule id + matched terms). */
export interface RankingExplanation {
  readonly ruleId: RankingRuleId;
  readonly matchedTerms: readonly string[];
}

export interface RankedKnowledgeArticle {
  readonly article: KnowledgeArticle;
  readonly explanation: readonly RankingExplanation[];
}

/** Fail-closed validity check of the adapter authorization decision (par. 3.2). */
export function isValidGrantedDecision(article: KnowledgeArticle): boolean {
  const decision = article.authorizationDecision;
  return (
    decision !== undefined &&
    decision.decidedBy === 'knowledge-adapter' &&
    decision.decision === 'granted' &&
    typeof decision.policyId === 'string' &&
    decision.policyId.trim().length > 0
  );
}

/**
 * Gate articles on publication, authorization, defense-in-depth audience,
 * language, validity and quality (v5.2 par. 5).
 */
export function gateKnowledgeArticles(
  articles: readonly KnowledgeArticle[],
  now: string,
  audience: string,
): readonly KnowledgeArticle[] {
  return articles.filter(
    (article) =>
      article.status === 'published' &&
      isValidGrantedDecision(article) &&
      article.audiencePolicy.allowedAudiences.includes(audience) &&
      article.language === 'nl' &&
      article.minimumQualityMet === true &&
      article.validFrom <= now &&
      (article.validUntil === undefined || article.validUntil > now),
  );
}

function keywordOverlaps(article: KnowledgeArticle, query: KnowledgeSearchQuery): readonly string[] {
  return query.keywords.filter((keyword) => article.keywords.includes(keyword));
}

function explanationFor(
  article: KnowledgeArticle,
  query: KnowledgeSearchQuery,
): readonly RankingExplanation[] {
  const explanation: RankingExplanation[] = [];
  if (query.subject !== undefined && article.subject === query.subject) {
    explanation.push({ ruleId: 'rank_subject_exact', matchedTerms: [query.subject] });
  }
  if (query.symptom !== undefined && article.symptom === query.symptom) {
    explanation.push({ ruleId: 'rank_symptom_match', matchedTerms: [query.symptom] });
  }
  if (query.requestedResource !== undefined && article.requestedResource === query.requestedResource) {
    explanation.push({ ruleId: 'rank_resource_match', matchedTerms: [query.requestedResource] });
  }
  const overlaps = keywordOverlaps(article, query);
  if (overlaps.length > 0) {
    explanation.push({ ruleId: 'rank_keyword_match', matchedTerms: overlaps });
  }
  return explanation;
}

/**
 * Approved relevance threshold (BUILD_03.md v5.2): only rank_keyword_match
 * with exactly one overlapping keyword and no further match rule falls
 * below the threshold.
 */
function meetsRelevanceThreshold(
  explanation: readonly RankingExplanation[],
  keywordOverlapCount: number,
): boolean {
  const hasNonKeywordRule = explanation.some((record) => record.ruleId !== 'rank_keyword_match');
  if (hasNonKeywordRule) {
    return true;
  }
  return keywordOverlapCount >= MIN_RELEVANT_KEYWORD_OVERLAPS;
}

/** Fixed relevance tuple: subject, symptom, resource, keyword. */
function relevanceKey(explanation: readonly RankingExplanation[]): readonly [number, number, number, number] {
  const has = (ruleId: RankingRuleId) => explanation.some((record) => record.ruleId === ruleId);
  return [
    has('rank_subject_exact') ? 1 : 0,
    has('rank_symptom_match') ? 1 : 0,
    has('rank_resource_match') ? 1 : 0,
    has('rank_keyword_match') ? 1 : 0,
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
 * threshold are excluded; the remaining order is fully deterministic
 * (lexicographic rule tuple, tie-break on article id ascending).
 */
export function rankKnowledgeArticles(
  gatedArticles: readonly KnowledgeArticle[],
  query: KnowledgeSearchQuery,
): readonly RankedKnowledgeArticle[] {
  const ranked: RankedKnowledgeArticle[] = [];
  for (const article of gatedArticles) {
    const explanation = explanationFor(article, query);
    const keywordOverlapCount =
      explanation.find((record) => record.ruleId === 'rank_keyword_match')?.matchedTerms.length ?? 0;
    if (meetsRelevanceThreshold(explanation, keywordOverlapCount)) {
      ranked.push({ article, explanation });
    }
  }
  ranked.sort((left, right) => {
    const byRelevance = compareRelevance(relevanceKey(left.explanation), relevanceKey(right.explanation));
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
