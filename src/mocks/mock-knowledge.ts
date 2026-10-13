import type {
  KnowledgeArticle,
  KnowledgeAuthorizationDecision,
  KnowledgePort,
  KnowledgeSearchQuery,
  KnowledgeSearchResponse,
} from '../ports/knowledge';

/**
 * Development/test knowledge adapter with fictional data only
 * (BUILD_03.md v5.2 par. 3.4). This mock models the future TOPdesk
 * Knowledge adapter boundary and its server-side obligations:
 *
 * - the catalogue fixtures carry the structured server-side
 *   authorization decisions (granted/denied/inconclusive, including the
 *   deliberately contradictory granted-without-policyId item);
 * - the mock returns FULL metadata without filtering up front, so
 *   Elvie's own fail-closed gating (par. 3.2/5) stays independently
 *   testable;
 * - the quality threshold is adapter-computed here (mock: title present,
 *   source reference present, at least one step);
 * - a denied article is indistinguishable from a non-existent one in the
 *   employee-facing reply: that distinction is only operational, never
 *   visible to the employee;
 * - there is no unbounded search: a query without any controlled signal
 *   returns no results;
 * - article content never appears in any log.
 */
export type MockKnowledgeDependencyMode = 'ok' | 'unavailable';

export interface MockKnowledgeProviderOptions {
  readonly articles?: readonly KnowledgeArticle[];
  /** Simulate a broken knowledge dependency. */
  readonly mode?: MockKnowledgeDependencyMode;
}

/** Adapter-computed quality verdict (BUILD_03.md v5.2 par. 5). */
function computeQuality(article: KnowledgeArticle): boolean {
  return (
    typeof article.title === 'string' &&
    article.title.trim().length > 0 &&
    typeof article.sourceReference === 'string' &&
    article.sourceReference.trim().length > 0 &&
    Array.isArray(article.steps) &&
    article.steps.length >= 1
  );
}

export class MockKnowledgeProvider implements KnowledgePort {
  private readonly articles: readonly KnowledgeArticle[];
  private readonly mode: MockKnowledgeDependencyMode;
  private readonly decisions: KnowledgeAuthorizationDecision[] = [];
  private readonly capturedQueries: KnowledgeSearchQuery[] = [];

  constructor(options: MockKnowledgeProviderOptions = {}) {
    this.articles = options.articles ?? DEFAULT_MOCK_KNOWLEDGE_ARTICLES;
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
      // Record the server-side decision for tests (never employee-facing).
      this.decisions.push(article.authorizationDecision);
      if (!this.matchesQuery(article, query)) {
        continue;
      }
      // Full metadata, no authorization prefiltering (v5.2 par. 3.4):
      // the engine gates fail-closed. Quality is computed adapter-side.
      results.push({ ...article, minimumQualityMet: computeQuality(article) });
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

function grantedDecision(policyId = 'policy-employee-kb'): KnowledgeAuthorizationDecision {
  return { decidedBy: 'knowledge-adapter', decision: 'granted', policyId };
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
    sourceReference: 'KB-' + id.toUpperCase(),
    status: 'published',
    language: 'nl',
    minimumQualityMet: true,
    validFrom: '2024-01-01T00:00:00.000Z',
    keywords: match.keywords ?? [],
    subject: match.subject,
    symptom: match.symptom,
    requestedResource: match.requestedResource,
    authorizationDecision: grantedDecision(),
    audiencePolicy: { allowedAudiences: ['employee'] },
    ...extra,
  };
}

/**
 * Fictional knowledge catalogue (BUILD_03.md v5.2 par. 3.4). No real
 * content. Negative test items per the approved specification:
 * - mock-kb-006: denied for this employee (policy_denied);
 * - mock-kb-007: draft status (gated out);
 * - mock-kb-008: expired (validUntil in the past);
 * - mock-kb-009: below the adapter-computed quality threshold (no steps);
 * - mock-kb-010: inconclusive authorization (policy_unavailable);
 * - mock-kb-012: not yet valid (validFrom in the far future);
 * - mock-kb-013: contradictory granted WITHOUT policyId (fail-closed);
 * - mock-kb-014: granted article with a non-fitting defense-in-depth
 *   audience (employee must never see it).
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
    'Intern protocol; niet beschikbaar voor medewerkers.',
    ['Volg het interne protocol.'],
    { subject: 'Account' },
    {
      authorizationDecision: {
        decidedBy: 'knowledge-adapter',
        decision: 'denied',
        reasonCategory: 'policy_denied',
      },
      audiencePolicy: { allowedAudiences: ['servicedesk'] },
    },
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
    [],
    { subject: 'laptop' },
  ),
  publishedArticle(
    'mock-kb-010',
    'Account-herstelprocedure',
    'Artikel waarvan het autorisatiebeleid niet beschikbaar is; fail-closed onzichtbaar.',
    ['Interne stap.'],
    { subject: 'Account' },
    {
      authorizationDecision: {
        decidedBy: 'knowledge-adapter',
        decision: 'inconclusive',
        reasonCategory: 'policy_unavailable',
      },
    },
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
    'Nog niet geldig artikel.',
    ['Stap.'],
    { subject: 'laptop' },
    { validFrom: '2100-01-01T00:00:00.000Z' },
  ),
  publishedArticle(
    'mock-kb-013',
    'Wachtwoordhulp intern (tegenstrijdig besluit)',
    'Artikel met een granted-besluit zonder policyId; fail-closed onzichtbaar.',
    ['Interne stap.'],
    { subject: 'Account' },
    { authorizationDecision: { decidedBy: 'knowledge-adapter', decision: 'granted' } },
  ),
  publishedArticle(
    'mock-kb-014',
    'Intern printerprotocol (defense-in-depth)',
    'Granted artikel met een niet-passend audience-beleid.',
    ['Interne stap.'],
    { subject: 'printer' },
    { audiencePolicy: { allowedAudiences: ['servicedesk'] } },
  ),
];
