/**
 * Knowledge port (BUILD_03.md): the only contract through which Elvie
 * consults service-desk knowledge. TOPdesk Knowledge Management is the
 * authoritative source; the real adapter arrives in a later build (Build 06).
 * The conversation domain depends only on this interface.
 *
 * Dataminimalisation (BUILD_03.md): every query field is a controlled,
 * explicitly allowlisted value (Build 02 recognition catalogue values and
 * symptom values). Raw employee input NEVER reaches this port.
 *
 * Authorization (BUILD_03.md): adapters MUST decide authorization
 * server-side, per article, before anything is returned. Denied or
 * untrustworthy (inconclusive) articles are invisible to the employee:
 * the response must never reveal that restricted knowledge exists.
 */

/** Intent of the current conversation (Build 02 enum; phishing never searches). */
export type KnowledgeQueryIntent = 'incident' | 'request' | 'phishing' | 'unknown';

/**
 * Allowlist-only knowledge query. subject, requestedResource and keywords
 * are canonical recognition-catalogue values; symptom is a controlled
 * Build 02 symptom value. No free-text field exists by design.
 */
export interface KnowledgeSearchQuery {
  readonly intent: KnowledgeQueryIntent;
  readonly subject?: string;
  readonly symptom?: string;
  readonly requestedResource?: string;
  readonly keywords: readonly string[];
}

export type KnowledgeArticleStatus = 'published' | 'draft' | 'archived';

/**
 * Trusted, server-side authorization metadata attached to an article.
 * Missing or contradictory metadata is treated fail-closed by adapters
 * (never as implicit access).
 */
export interface KnowledgeArticleAuthorization {
  readonly policyId: string;
  readonly allowedAudiences: readonly string[];
}

/**
 * One knowledge article with the metadata Build 03 needs for publication,
 * validity, quality and deterministic matching. Article content never
 * enters logs (AUDIT_LOGGING.md).
 */
export interface KnowledgeArticle {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly status: KnowledgeArticleStatus;
  readonly language: 'nl-NL';
  readonly minimumQualityMet: boolean;
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly subject?: string;
  readonly symptom?: string;
  readonly requestedResource?: string;
  readonly keywords: readonly string[];
  readonly authorization: KnowledgeArticleAuthorization;
}

/**
 * Server-side authorization decision per article (mandatory contract).
 * granted REQUIRES the policyId that allowed access; denied/inconclusive
 * REQUIRE a safe reason category. The employee never sees any of this.
 */
export type KnowledgeAuthorizationDecision =
  | {
      readonly decidedBy: 'knowledge-adapter';
      readonly articleId: string;
      readonly status: 'granted';
      readonly policyId: string;
    }
  | {
      readonly decidedBy: 'knowledge-adapter';
      readonly articleId: string;
      readonly status: 'denied' | 'inconclusive';
      readonly reasonCategory: string;
    };

/**
 * Search response. results contains ONLY authorized (granted) articles.
 * outcome distinguishes a healthy empty result from an unavailable
 * knowledge dependency; it never distinguishes "only denied articles"
 * from "no articles at all" for the employee-facing text.
 */
export interface KnowledgeSearchResponse {
  readonly results: readonly KnowledgeArticle[];
  readonly outcome: 'ok' | 'no_results' | 'unavailable';
}

export interface KnowledgePort {
  /** Search knowledge. Deterministic; no employee free text is involved. */
  search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse>;
}

/** Raised when no knowledge implementation is configured. */
export class KnowledgeNotConfiguredError extends Error {
  constructor(message = 'Knowledge provider is not configured.') {
    super(message);
    this.name = 'KnowledgeNotConfiguredError';
  }
}

/** Fail-closed knowledge implementation for unconfigured compositions. */
export function unconfiguredKnowledge(): KnowledgePort {
  return {
    async search(): Promise<KnowledgeSearchResponse> {
      throw new KnowledgeNotConfiguredError();
    },
  };
}
