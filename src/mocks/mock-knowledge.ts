import type {
  KnowledgeArticle,
  KnowledgeAuthorizationDecision,
  KnowledgePort,
  KnowledgeSearchQuery,
  KnowledgeSearchResponse,
} from '../ports/knowledge';

/**
 * Development/test knowledge adapter with fictional data only
 * (BUILD_03.md). This mock models the future TOPdesk Knowledge adapter
 * boundary and its server-side obligations:
 *
 * - authorization is decided HERE, per article, before anything is
 *   returned (granted requires the article policyId; denied/inconclusive
 *   require a safe reason category);
 * - untrustworthy authorization metadata (missing/empty policyId or a
 *   non-array audience list) is fail-closed: the article is invisible and
 *   logged internally as inconclusive;
 * - a denied article is indistinguishable from a non-existent one in the
 *   response: results and outcome are identical to the no-results case;
 * - there is no unbounded search: a query without any controlled signal
 *   returns no results;
 * - article content never appears in any log.
 */
export type MockKnowledgeDependencyMode = 'ok' | 'unavailable';

export interface MockKnowledgeProviderOptions {
  readonly articles?: readonly KnowledgeArticle[];
  /** Audience of the (fictional) authenticated employee. */
  readonly audience?: string;
  /** Simulate a broken knowledge dependency. */
  readonly mode?: MockKnowledgeDependencyMode;
}

export class MockKnowledgeProvider implements KnowledgePort {
  private readonly articles: readonly KnowledgeArticle[];
  private readonly audience: string;
  private readonly mode: MockKnowledgeDependencyMode;
  private readonly decisions: KnowledgeAuthorizationDecision[] = [];
  private readonly capturedQueries: KnowledgeSearchQuery[] = [];

  constructor(options: MockKnowledgeProviderOptions = {}) {
    this.articles = options.articles ?? DEFAULT_MOCK_KNOWLEDGE_ARTICLES;
    this.audience = options.audience ?? 'employee';
    this.mode = options.mode ?? 'ok';
  }

  async search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
    this.capturedQueries.push(query);
    if (this.mode === 'unavailable') {
      throw new Error('Simulated knowledge dependency failure');
    }
    const hasSignal =
      query.subject !== undefined ||
      query.symptom !== undefined ||
      query.requestedResource !== undefined ||
      query.keywords.length > 0;
    if (!hasSignal) {
      // No unbounded search without a controlled signal.
      this.decisions.length = 0;
      return { results: [], outcome: 'no_results' };
    }
    this.decisions.length = 0;
    const results: KnowledgeArticle[] = [];
    for (const article of this.articles) {
      const decision = this.decideAuthorization(article);
      this.decisions.push(decision);
      if (decision.status !== 'granted') {
        continue;
      }
      if (this.matchesQuery(article, query)) {
        results.push(article);
      }
    }
    return { results, outcome: results.length > 0 ? 'ok' : 'no_results' };
  }

  /** Authorization decisions of the most recent search (internal, test-only). */
  get lastAuthorizationDecisions(): readonly KnowledgeAuthorizationDecision[] {
    return this.decisions;
  }

  /** Queries captured by the mock (test-only; allowlist fields only). */
  get capturedSearchQueries(): readonly KnowledgeSearchQuery[] {
    return this.capturedQueries;
  }

  private decideAuthorization(article: KnowledgeArticle): KnowledgeAuthorizationDecision {
    const meta = article.authorization;
    const trustworthy =
      meta !== undefined &&
      typeof meta.policyId === 'string' &&
      meta.policyId.length > 0 &&
      Array.isArray(meta.allowedAudiences);
    if (!trustworthy) {
      // Fail-closed: untrustworthy metadata never grants access.
      return {
        decidedBy: 'knowledge-adapter',
        articleId: article.id,
        status: 'inconclusive',
        reasonCategory: 'untrustworthy_authorization_metadata',
      };
    }
    if (!meta.allowedAudiences.includes(this.audience)) {
      return {
        decidedBy: 'knowledge-adapter',
        articleId: article.id,
        status: 'denied',
        reasonCategory: 'audience_not_allowed',
      };
    }
    return {
      decidedBy: 'knowledge-adapter',
      articleId: article.id,
      status: 'granted',
      policyId: meta.policyId,
    };
  }

  private matchesQuery(article: KnowledgeArticle, query: KnowledgeSearchQuery): boolean {
    const keywordMatch = query.keywords.some((keyword) => article.keywords.includes(keyword));
    return (
      (query.subject !== undefined && article.subject === query.subject) ||
      (query.symptom !== undefined && article.symptom === query.symptom) ||
      (query.requestedResource !== undefined && article.requestedResource === query.requestedResource) ||
      keywordMatch
    );
  }
}

function publishedArticle(
  id: string,
  title: string,
  summary: string,
  steps: readonly string[],
  match: { subject?: string; symptom?: string; requestedResource?: string; keywords?: readonly string[] },
  extra: Partial<KnowledgeArticle> = {},
): KnowledgeArticle {
  return {
    id,
    title,
    summary,
    steps,
    status: 'published',
    language: 'nl-NL',
    minimumQualityMet: true,
    validFrom: '2024-01-01T00:00:00.000Z',
    keywords: match.keywords ?? [],
    subject: match.subject,
    symptom: match.symptom,
    requestedResource: match.requestedResource,
    authorization: { policyId: 'policy-employee-kb', allowedAudiences: ['employee'] },
    ...extra,
  };
}

/**
 * Fictional knowledge catalogue (BUILD_03.md par. 5). No real LV or
 * TOPdesk content. Includes explicit negative test items:
 * - mock-kb-006: restricted audience (denied for employees);
 * - mock-kb-007: draft status (gated out);
 * - mock-kb-008: expired (validUntil in the past);
 * - mock-kb-009: minimum quality not met;
 * - mock-kb-010: untrustworthy authorization metadata (fail-closed);
 * - mock-kb-012: not yet valid (validFrom in the far future).
 */
export const DEFAULT_MOCK_KNOWLEDGE_ARTICLES: readonly KnowledgeArticle[] = [
  publishedArticle(
    'mock-kb-001',
    'Wachtwoord opnieuw instellen',
    'Stel je wachtwoord opnieuw in via de selfserviceportal met je registratiegegevens.',
    ['Open de selfserviceportal.', 'Kies wachtwoord opnieuw instellen.', 'Volg de instructies op het scherm.'],
    { subject: 'Account', requestedResource: 'Account', keywords: ['Account'] },
  ),
  publishedArticle(
    'mock-kb-002',
    'VPN-verbinding herstellen',
    'Herstart de VPN-client en controleer of je verbonden bent met het juiste netwerk.',
    ['Sluit de VPN-client af.', 'Herstart de VPN-client.', 'Meld je opnieuw aan.'],
    { subject: 'laptop', symptom: 'no_connection', keywords: ['laptop'] },
  ),
  publishedArticle(
    'mock-kb-003',
    'Printer komt niet gereed',
    'Controleer of de printer is aangezet en of er papier in de lade zit.',
    ['Controleer de stroomvoorziening.', 'Controleer de papierlade.', 'Herstart de printer.'],
    { subject: 'printer', symptom: 'not_working', keywords: ['printer'] },
  ),
  publishedArticle(
    'mock-kb-004',
    'Outlook start niet',
    'Herstart Outlook en controleer of je verbinding hebt met het netwerk.',
    ['Sluit Outlook af.', 'Herstart Outlook.', 'Controleer de netwerkverbinding.'],
    { subject: 'Outlook', symptom: 'not_working', keywords: ['Outlook'] },
  ),
  publishedArticle(
    'mock-kb-005',
    'Teams-vergadering valt weg',
    'Herstart Teams en controleer of je microfoon en camera goed zijn aangesloten.',
    ['Herstart Teams.', 'Controleer de apparatuur.', 'Probeer opnieuw te verbinden.'],
    { subject: 'Teams', symptom: 'erratic_behavior', keywords: ['Teams'] },
  ),
  publishedArticle(
    'mock-kb-006',
    'Intern afhandelingsprotocol',
    'Intern protocol; niet bedoeld voor medewerkers.',
    ['Volg het interne protocol.'],
    { subject: 'Account' },
    { authorization: { policyId: 'policy-servicedesk-only', allowedAudiences: ['servicedesk'] } },
  ),
  publishedArticle(
    'mock-kb-007',
    'Mailbox-delegering (concept)',
    'Conceptartikel over gedelegeerde toegang.',
    ['Conceptstap.'],
    { subject: 'Mailbox' },
    { status: 'draft' },
  ),
  publishedArticle(
    'mock-kb-008',
    'Oude VPN-instructie (verlopen)',
    'Verlopen instructie voor de oude VPN-client.',
    ['Verlopen.'],
    { subject: 'laptop' },
    { validUntil: '2025-01-01T00:00:00.000Z' },
  ),
  publishedArticle(
    'mock-kb-009',
    'Laptop traag (kwaliteit onvoldoende)',
    'Artikel heeft de minimale kwaliteitscontrole nog niet doorlopen.',
    ['Controleer actieve programma\'s.'],
    { subject: 'laptop' },
    { minimumQualityMet: false },
  ),
  publishedArticle(
    'mock-kb-010',
    'Account-herstelprocedure',
    'Artikel met onbetrouwbare autorisatiemetadata; fail-closed onzichtbaar.',
    ['Interne stap.'],
    { subject: 'Account' },
    { authorization: { policyId: '', allowedAudiences: ['employee'] } },
  ),
  publishedArticle(
    'mock-kb-011',
    'Toegang tot gedeelde mailbox aanvragen',
    'Vraag toegang aan via het aanvraagformulier van de servicebalie.',
    ['Open het aanvraagformulier.', 'Kies de gedeelde mailbox.', 'Dien de aanvraag in.'],
    { subject: 'Mailbox', requestedResource: 'Mailbox', keywords: ['Mailbox'] },
  ),
  publishedArticle(
    'mock-kb-012',
    'Toekomstige laptopinstructie',
    'Nog niet gepubliceerd geldig artikel.',
    ['Stap.'],
    { subject: 'laptop' },
    { validFrom: '2100-01-01T00:00:00.000Z' },
  ),
];
