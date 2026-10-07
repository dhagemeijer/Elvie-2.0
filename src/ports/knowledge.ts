/**
 * Knowledge port (BUILD_03.md v5.2): the only contract through which Elvie
 * consults service-desk knowledge. TOPdesk Knowledge Management is the
 * authoritative source; the real adapter arrives in a later build (Build 06).
 * The conversation domain depends only on this interface.
 *
 * Dataminimalisation (v5.2 par. 4): every query field is a controlled,
 * explicitly allowlisted value (Build 02 recognition catalogue values and
 * symptom values). Raw employee input NEVER reaches this port.
 *
 * Authorization (v5.2 par. 3): adapters MUST decide authorization
 * server-side, per article, before anything is returned. Denied or
 * inconclusive articles are invisible to the employee: the response must
 * never reveal that restricted knowledge exists.
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
 * Structured, server-side authorization decision per article (v5.2
 * par. 3.1); a loose boolean is never sufficient proof. granted REQUIRES
 * the policyId that allowed access; denied/inconclusive REQUIRE a safe
 * reason category. The employee never sees any of this.
 */
export interface KnowledgeAuthorizationDecision {
  readonly decidedBy: 'knowledge-adapter';
  readonly decision: 'granted' | 'denied' | 'inconclusive';
  readonly policyId?: string;
  readonly reasonCategory?: 'policy_unavailable' | 'identity_unverifiable' | 'policy_denied' | 'metadata_incomplete';
}

/**
 * Defense-in-depth audience policy attached to an article (v5.2 par. 3.2).
 * Independent of the adapter decision; both layers are separately
 * testable.
 */
export interface KnowledgeArticleAudiencePolicy {
  readonly allowedAudiences: readonly string[];
}

/**
 * One knowledge article with the metadata Build 03 needs for publication,
 * validity, quality and deterministic matching (v5.2 par. 3.4/5). Article
 * content never enters logs (AUDIT_LOGGING.md).
 */
export interface KnowledgeArticle {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
  /** Catalogue reference for the source citation in the presentation (par. 6). */
  readonly sourceReference: string;
  readonly status: KnowledgeArticleStatus;
  readonly language: 'nl';
  /** Adapter-computed quality verdict (mock: title, source reference, >=1 step). */
  readonly minimumQualityMet: boolean;
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly subject?: string;
  readonly symptom?: string;
  readonly requestedResource?: string;
  readonly keywords: readonly string[];
  /** Mandatory structured server-side authorization decision (par. 3.1). */
  readonly authorizationDecision: KnowledgeAuthorizationDecision;
  /** Defense-in-depth audience policy (par. 3.2). */
  readonly audiencePolicy: KnowledgeArticleAudiencePolicy;
}

/**
 * Search response. The mock adapter returns full metadata without
 * filtering up front (v5.2 par. 3.4); Elvie's own defense-in-depth
 * gating (par. 5) is applied separately and remains testable.
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
