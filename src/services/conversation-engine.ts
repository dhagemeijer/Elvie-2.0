import type { ConversationContext, ConversationFactValue, ConversationStateName } from '../domain/conversation-context';
import {
  createConversationContext,
  getAnswer,
  getFact,
  hasReliableFact,
  recordAnswer,
} from '../domain/conversation-context';
import type { FactCategory } from '../domain/facts';
import { processEmployeeMessage } from '../domain/conversation-core';
import { FACT_QUESTIONS } from '../domain/conversation-decision';
import { buildKnowledgeQuery } from '../domain/knowledge-request';
import { gateKnowledgeArticles, rankKnowledgeArticles, type RankedKnowledgeArticle } from '../domain/knowledge-ranking';
import { calculateMissingFacts, FICTIONAL_REQUIREMENT_RULES } from '../domain/requirements';
import { applyTransition } from '../domain/state-machine';
import type { IdentityPort } from '../ports/identity';
import type { KnowledgeArticle, KnowledgePort } from '../ports/knowledge';
import type { AuditEvent, AuditLoggerPort, OperationalLoggerPort } from '../ports/logging';
import { createAuditEvent } from '../ports/logging';
import type { SubmissionKey, TicketDraft, TicketPort, TicketSubmissionResult } from '../ports/ticket';
import { isContractValidStatus, isContractValidSubmission, makeSubmissionKey } from '../ports/ticket';
import { containsSensitiveValue } from '../security/sensitive-values';
import { APP_VERSION, COMPONENT_CONVERSATION_ENGINE } from '../support/app-info';
import { makeId, nowIso } from '../support/ids';

/** Message roles for the chat shell. `error` is a user-safe failure state. */
export type ChatMessageRole = 'elvie' | 'employee' | 'error';
export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly text: string;
}

/** Maximum number of distinct knowledge articles per resolution series. */
export const MAX_KNOWLEDGE_ARTICLES_PER_SERIES = 3;

/**
 * Configurable, neutral employee-facing texts (BUILD_03.md v5.2 par. 9.1/
 * 9.2/12.2). Defaults are simulation-honest: every message about
 * registration, sending or storage states explicitly that Build 03 is a
 * simulation and that no real TOPdesk registration takes place. The
 * definitive organization wording is a configuration decision.
 */
export interface EngineTexts {
  readonly securityInstruction: string;
  readonly securityIntakePrompt: string;
  readonly noKnowledgeFound: string;
  readonly knowledgeExhausted: string;
  readonly knowledgeDependencyError: string;
  readonly resolvedDone: string;
  readonly threeWayQuestion: string;
  readonly previewIntro: string;
  readonly previewConfirmPrompt: string;
  readonly submissionSuccess: string;
  readonly submissionFailed: string;
  readonly submissionInconclusive: string;
}

export const DEFAULT_ENGINE_TEXTS: EngineTexts = {
  // par. 9.1: safe phishing instruction; no registration or sending claim.
  securityInstruction:
    "Ik kan je hierbij niet rechtstreeks helpen. Ik kan je situatie niet registreren of versturen — dit gesprek is een simulatie. Ik zet je gegevens niet automatisch ergens vast. Volg de instructies zoals die binnen je organisatie zijn gecommuniceerd, of neem direct contact op met de IT-servicebalie.",
  securityIntakePrompt:
    "We kunnen deze situatie vastleggen als beveiligingsmelding in deze simulatie. Heb je nog aanvullende details? Typ ze hier, of typ 'klaar' om verder te gaan.",
  // par. 3.3: identical text for "no results" and "only restricted results".
  noKnowledgeFound: 'Ik heb hiervoor geen passende instructies gevonden.',
  knowledgeExhausted:
    'Ik heb geen verdere oplossingen om aan te bieden. We kunnen je situatie vastleggen in deze simulatie.',
  knowledgeDependencyError:
    "De kennisvoorziening is op dit moment niet beschikbaar, waardoor ik geen oplossingen kan opzoeken. Typ 'opnieuw' om het nogmaals te proberen, of 'melding' om je situatie direct vast te leggen.",
  resolvedDone: 'Fijn dat dit je verder hielp. Fijne dag!',
  // par. 7: fixed three-way question.
  threeWayQuestion: "Lost dit je probleem op? Antwoord 'opgelost', 'niet opgelost' of 'onduidelijk'.",
  // par. 9.2: preview is explicitly a simulation; no real registration.
  previewIntro: 'Dit is een voorbeeld (simulatie) van je melding. Er wordt in deze versie van Elvie niets naar TOPdesk verzonden — je bekijkt een voorbeeld. Bevestig om de simulatie af te ronden.',
  previewConfirmPrompt:
    "Typ 'bevestigen' of 'versturen' om de simulatie af te ronden, of beschrijf wat je wilt aanpassen.",
  // par. 9.2: mock success states the simulation explicitly.
  submissionSuccess:
    'De simulatie is afgerond met voorbeeldreferentie REFERENTIE. Let op: dit is een simulatie — er is géén echte TOPdesk-melding aangemaakt. Neem voor echte afhandeling contact op met de IT-servicebalie.',
  // par. 12.2: definitive failure; nothing stored or sent.
  submissionFailed:
    'Het versturen is niet gelukt; er is niets vastgelegd of verzonden. Je kunt het opnieuw proberen of contact opnemen met de IT-servicebalie.',
  // par. 12.2: uncertain outcome; nothing resent, service desk reference.
  submissionInconclusive:
    'Het is niet zeker of de simulatie is aangekomen. Ik heb niets opnieuw verstuurd om dubbele verwerking te voorkomen. Neem bij twijfel contact op met de IT-servicebalie.',
};

export interface ConversationEngineDeps {
  readonly identity: IdentityPort;
  readonly knowledge: KnowledgePort;
  readonly ticket: TicketPort;
  readonly operational: OperationalLoggerPort;
  readonly audit: AuditLoggerPort;
  /** Configurable, neutral employee-facing texts (organization wording). */
  readonly texts?: Partial<EngineTexts>;
  /** Injected clock for deterministic validity gating (defaults to now). */
  readonly now?: () => string;
  /** Employee audience for the defense-in-depth gate (defaults to employee). */
  readonly audience?: string;
}

/** Feedback classification of resolution answers (deterministic). */
type ResolutionFeedback = 'opgelost' | 'niet_opgelost' | 'onduidelijk';

/**
 * Deterministic conversation engine.
 *
 * Build 02: the UNDERSTAND phase is powered by the deterministic
 * Conversation Core. Build 03 (BUILD_03.md v5.2/v5.2.1) adds knowledge
 * search with allowlist queries, deterministic fail-closed gating and
 * ranking with explainable match rules, the guided resolution flow with a
 * KnowledgePhase substatus, the generic intake (incident/request/
 * security), never-knowingly-ask-twice on engine level, and the
 * idempotent TicketPort submission protocol with a deferred SUBMIT
 * transition and status-only recovery. The engine only decides WHEN to
 * move between the authoritative Build 01 lifecycle states; it never
 * invents new transitions or states.
 */
export class ConversationEngine {
  private context: ConversationContext | null = null;
  private actorId = 'unknown';
  private rankedArticles: readonly RankedKnowledgeArticle[] = [];
  private readonly texts: EngineTexts;
  private readonly now: () => string;
  private readonly audience: string;

  constructor(private readonly deps: ConversationEngineDeps) {
    this.texts = { ...DEFAULT_ENGINE_TEXTS, ...deps.texts };
    this.now = deps.now ?? nowIso;
    this.audience = deps.audience ?? 'employee';
  }

  /** Current lifecycle state for diagnostics/tests; null before start. */
  public get currentState(): ConversationStateName | null {
    return this.context === null ? null : this.context.currentState;
  }

  /**
   * Start a conversation. Authenticates first: when identity is not
   * configured, the engine fails closed and never creates a session.
   */
  async start(): Promise<readonly ChatMessage[]> {
    try {
      const employee = await this.deps.identity.getCurrentEmployee();
      this.actorId = employee.id;
      this.context = createConversationContext(makeId(), nowIso());
      this.rankedArticles = [];
      this.operational('info', 'conversation started', 'success');
      return [
        {
          role: 'elvie',
          text: 'Hallo ' + employee.displayName + '! Ik ben Elvie, de digitale assistent van de IT-servicebalie.',
        },
        { role: 'elvie', text: 'Waarmee kan ik je helpen? Beschrijf je vraag of probleem.' },
      ];
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      // Normal employee authentication failure, NOT an administrative action:
      // use a neutral session event type. Administrative audit event types
      // are reserved for genuine administrative access (Build 05+).
      this.auditSafe(
        createAuditEvent({
          eventType: 'employee_session_establishment',
          actorId: 'unauthenticated',
          action: 'establish_session',
          outcome: 'failed',
          correlationId: 'none',
          component: COMPONENT_CONVERSATION_ENGINE,
          reason,
          appVersion: APP_VERSION,
        }),
      );
      this.operational('error', 'identity check failed; access denied (fail closed)', 'failure', reason);
      return [
        {
          role: 'error',
          text: 'Elvie is op dit moment niet beschikbaar: de applicatie is niet volledig geconfigureerd. Neem contact op met de IT-servicebalie.',
        },
      ];
    }
  }

  /** Handle one line of employee input, deterministically per current state. */
  async handleEmployeeInput(text: string): Promise<readonly ChatMessage[]> {
    const context = this.context;
    if (context === null) {
      return [{ role: 'error', text: 'Er is nog geen gesprek gestart.' }];
    }
    if (text.trim().length === 0) {
      return [{ role: 'elvie', text: 'Typ eerst een korte omschrijving van je vraag.' }];
    }

    // Server-side PII safeguard: warn and do not store or forward the value.
    if (containsSensitiveValue(text)) {
      this.operational('warn', 'sensitive value detected in input; blocked from storage', 'success', 'pii-guard');
      return [
        {
          role: 'elvie',
          text: 'Let op: je bericht lijkt gevoelige gegevens te bevatten (zoals een BSN of IBAN). Verwijder die gegevens en stuur je bericht opnieuw.',
        },
      ];
    }

    // Logical turn ordering (1-based; NOT wall-clock time).
    context.currentTurn += 1;

    switch (context.currentState) {
      case 'START':
      case 'UNDERSTAND':
        return this.handleUnderstand(text);
      case 'KNOWLEDGE_SEARCH':
        return this.handleKnowledgePhase(text);
      case 'INTAKE':
        return this.handleIntake(text);
      case 'COMPLETE_CONTEXT':
        return this.handleCompleteContext(text);
      case 'PREVIEW':
        return this.handlePreview(text);
      case 'DONE':
      case 'CONFIRM':
        return [{ role: 'elvie', text: 'Dit gesprek is afgerond. Start een nieuw gesprek voor een nieuwe vraag.' }];
      default:
        return [{ role: 'error', text: 'Deze stap is nog niet beschikbaar in deze build.' }];
    }
  }

  // --- UNDERSTAND ----------------------------------------------------------

  /**
   * UNDERSTAND: run the deterministic Conversation Core and follow its
   * decision. Insufficient understanding keeps the conversation in
   * UNDERSTAND; a security-sensitive report follows the specialized
   * security route (NO knowledge search); incident and request continue
   * to the regular knowledge search.
   */
  private async handleUnderstand(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    if (context.currentState === 'START') {
      applyTransition(context, 'UNDERSTAND');
    }
    if (context.currentTurn === 1) {
      recordAnswer(context, 'initial_question', text);
    }

    const { decision } = processEmployeeMessage(context, text);
    // Safe diagnostics only: decision category, never raw input content.
    this.operational('info', 'employee message processed', 'success', decision.kind);

    switch (decision.kind) {
      case 'unknown_understanding':
        return [{ role: 'elvie', text: decision.text }];
      case 'missing_information':
        return [{ role: 'elvie', text: decision.nextQuestion.text }];
      case 'clarification_required':
        return [{ role: 'elvie', text: decision.text }];
      case 'security_sensitive_route':
        return this.handleSecurityRoute();
      case 'sufficient_understanding':
        return this.searchKnowledge();
    }
  }

  /**
   * Phishing/security route (BUILD_03.md v5.2 par. 9): a NEUTRAL,
   * configurable security instruction followed by a specialized security
   * intake. The knowledge port is NEVER consulted; the lifecycle only
   * passes through KNOWLEDGE_SEARCH via existing edges.
   */
  private handleSecurityRoute(): readonly ChatMessage[] {
    const context = this.requireContext();
    context.intakeType = 'security';
    this.operational('info', 'security route: knowledge search bypassed', 'success');
    applyTransition(context, 'KNOWLEDGE_SEARCH');
    applyTransition(context, 'INTAKE');
    return [
      { role: 'elvie', text: this.texts.securityInstruction },
      { role: 'elvie', text: this.texts.securityIntakePrompt },
    ];
  }

  // --- Knowledge search and guided resolution -------------------------------

  /** KNOWLEDGE_SEARCH: consult the knowledge port with an allowlist query. */
  private async searchKnowledge(): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    applyTransition(context, 'KNOWLEDGE_SEARCH');
    context.intakeType =
      (context.intentClassification?.value ?? context.intent) === 'request' ? 'request' : 'incident';
    return this.runKnowledgeSearch();
  }

  private async runKnowledgeSearch(): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    context.knowledgePhase = 'searching';
    this.operational('info', 'searching knowledge', 'success');

    const query = buildKnowledgeQuery(context);
    let response;
    try {
      response = await this.deps.knowledge.search(query);
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      return this.knowledgeDependencyFailure(reason);
    }
    if (response.outcome === 'unavailable') {
      return this.knowledgeDependencyFailure('knowledge_unavailable');
    }

    const gated = gateKnowledgeArticles(response.results, this.now(), this.audience);
    const ranked = rankKnowledgeArticles(gated, query);
    this.rankedArticles = ranked;
    context.knowledgeOfferedArticleIds = [];
    if (ranked.length === 0) {
      // Internal, safe-category logging only (par. 3.3): never visible to
      // the employee and never containing article content.
      this.logKnowledgeNoResults(response.results);
      context.knowledgePhase = 'exhausted';
      return this.goToIntake(this.texts.noKnowledgeFound);
    }
    return this.offerNextArticle();
  }

  /**
   * Safe internal categories when nothing can be offered: a denied
   * article, an inconclusive/absent authorization decision and a plain
   * no-results outcome are logged separately, with safe ids/categories
   * only. The employee sees the identical no-results text in every case.
   */
  private logKnowledgeNoResults(results: readonly KnowledgeArticle[]): void {
    const denied = results.some((article) => article.authorizationDecision?.decision === 'denied');
    const inconclusive = results.some(
      (article) =>
        article.authorizationDecision === undefined || article.authorizationDecision.decision === 'inconclusive',
    );
    if (denied) {
      this.operational('warn', 'knowledge search: restricted results present', 'success', 'authorization_denied');
    }
    if (inconclusive) {
      this.operational(
        'warn',
        'knowledge search: unverifiable authorization present',
        'success',
        'authorization_inconclusive',
      );
    }
    this.operational('info', 'knowledge search: no usable results', 'success', 'no_results');
  }

  /** Safe dependency failure; identical employee text, no leak. */
  private knowledgeDependencyFailure(reason: string): readonly ChatMessage[] {
    const context = this.requireContext();
    context.knowledgePhase = 'dependency_error';
    this.operational('error', 'knowledge dependency failed', 'failure', reason);
    return [{ role: 'elvie', text: this.texts.knowledgeDependencyError }];
  }

  /**
   * Offer the next not-yet-offered article (max. MAX_KNOWLEDGE_ARTICLES_
   * PER_SERIES distinct articles per resolution series). Exhaustion leads
   * deterministically to the generic intake.
   */
  private offerNextArticle(): readonly ChatMessage[] {
    const context = this.requireContext();
    const next = this.rankedArticles.find(
      (ranked) => !context.knowledgeOfferedArticleIds.includes(ranked.article.id),
    );
    if (next === undefined || context.knowledgeOfferedArticleIds.length >= MAX_KNOWLEDGE_ARTICLES_PER_SERIES) {
      context.knowledgePhase = 'exhausted';
      return this.goToIntake(this.texts.knowledgeExhausted);
    }
    context.knowledgeOfferedArticleIds.push(next.article.id);
    context.currentKnowledgeArticleId = next.article.id;
    context.knowledgePhase = 'awaiting_feedback';
    return [
      { role: 'elvie', text: renderArticle(next.article) },
      { role: 'elvie', text: this.texts.threeWayQuestion },
    ];
  }

  /**
   * KNOWLEDGE_SEARCH input handling per KnowledgePhase substatus. Input
   * after a search failure is NEVER interpreted as resolution feedback.
   */
  private async handleKnowledgePhase(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const phase = context.knowledgePhase ?? 'searching';
    switch (phase) {
      case 'dependency_error': {
        const answer = text.trim().toLowerCase();
        if (answer.includes('opnieuw')) {
          return this.runKnowledgeSearch();
        }
        if (answer.includes('melding')) {
          return this.goToIntake(this.texts.noKnowledgeFound);
        }
        // Any other input after a search failure is never feedback.
        return [{ role: 'elvie', text: this.texts.knowledgeDependencyError }];
      }
      case 'awaiting_feedback':
        return this.handleResolutionFeedback(text);
      case 'clarifying':
        return this.handleResolutionClarification(text);
      case 'exhausted':
        return this.goToIntake(this.texts.knowledgeExhausted);
      case 'searching':
        return [{ role: 'elvie', text: this.texts.threeWayQuestion }];
    }
  }

  /** Driewegfeedback on the currently offered article. */
  private handleResolutionFeedback(text: string): readonly ChatMessage[] {
    const context = this.requireContext();
    const feedback = classifyResolutionFeedback(text);
    if (feedback === undefined) {
      context.knowledgePhase = 'clarifying';
      return [
        {
          role: 'elvie',
          text: 'Ik begrijp je antwoord niet helemaal. ' + this.texts.threeWayQuestion,
        },
      ];
    }
    switch (feedback) {
      case 'opgelost': {
        // DONE only after explicit confirmation by the employee.
        applyTransition(context, 'RESOLVE');
        applyTransition(context, 'DONE');
        context.knowledgePhase = undefined;
        context.currentKnowledgeArticleId = undefined;
        this.operational('info', 'knowledge resolved the issue', 'success');
        return [{ role: 'elvie', text: this.texts.resolvedDone }];
      }
      case 'niet_opgelost': {
        context.unclearFeedbackCount = 0;
        return this.offerNextArticle();
      }
      case 'onduidelijk': {
        context.unclearFeedbackCount += 1;
        if (context.unclearFeedbackCount >= 2) {
          // Repeated unclear answers never loop forever: after one
          // clarification round the series moves on deterministically.
          context.unclearFeedbackCount = 0;
          return this.offerNextArticle();
        }
        context.knowledgePhase = 'clarifying';
        return [
          {
            role: 'elvie',
            text: 'Geen probleem. Wat is onduidelijk aan deze instructies?',
          },
        ];
      }
    }
  }

  /**
   * Clarifying input about the current article: never automatically treated
   * as a rejection. Explicit feedback words are honoured as feedback;
   * other input enriches the context and re-offers the same article.
   */
  private handleResolutionClarification(text: string): readonly ChatMessage[] {
    const context = this.requireContext();
    const feedback = classifyResolutionFeedback(text);
    if (feedback !== undefined) {
      return this.handleResolutionFeedback(text);
    }
    processEmployeeMessage(context, text);
    const article = this.currentArticle();
    context.knowledgePhase = 'awaiting_feedback';
    if (article === undefined) {
      return this.offerNextArticle();
    }
    return [
      { role: 'elvie', text: 'Dank voor je toelichting.' },
      { role: 'elvie', text: renderArticle(article) },
      { role: 'elvie', text: this.texts.threeWayQuestion },
    ];
  }

  private currentArticle(): KnowledgeArticle | undefined {
    const context = this.requireContext();
    const id = context.currentKnowledgeArticleId;
    if (id === undefined) {
      return undefined;
    }
    return this.rankedArticles.find((ranked) => ranked.article.id === id)?.article;
  }

  /**
   * Controlled transition to the generic intake. Reuses all reliably known
   * context data and asks only for genuinely missing information.
   */
  private goToIntake(intro: string): readonly ChatMessage[] {
    const context = this.requireContext();
    applyTransition(context, 'INTAKE');
    context.knowledgePhase = undefined;
    context.currentKnowledgeArticleId = undefined;
    this.rankedArticles = [];
    const missing = calculateMissingFacts(context, FICTIONAL_REQUIREMENT_RULES).missing;
    const category = missing[0];
    if (category !== undefined) {
      context.pendingIntakeCategory = category;
      return [{ role: 'elvie', text: intro }, { role: 'elvie', text: FACT_QUESTIONS[category] }];
    }
    // Everything required is already reliably known: complete the context
    // and show the preview without asking anything twice.
    applyTransition(context, 'COMPLETE_CONTEXT');
    applyTransition(context, 'PREVIEW');
    return [{ role: 'elvie', text: intro }, ...this.previewMessages()];
  }

  // --- Generic intake -------------------------------------------------------

  /**
   * INTAKE: process the answer through the Build 02 core (so known facts
   * are reused), retain answers the core cannot structure (never ask
   * twice), and ask only for the next genuinely missing category.
   */
  private handleIntake(text: string): Promise<readonly ChatMessage[]> {
    const result = this.processIntakeAnswer(text);
    return Promise.resolve(result);
  }

  private handleCompleteContext(text: string): Promise<readonly ChatMessage[]> {
    const result = this.processIntakeAnswer(text);
    return Promise.resolve(result);
  }

  private processIntakeAnswer(text: string): readonly ChatMessage[] {
    const context = this.requireContext();
    const pending = context.pendingIntakeCategory;
    processEmployeeMessage(context, text);
    context.pendingIntakeCategory = undefined;
    if (pending !== undefined && !hasReliableFact(context, pending)) {
      // The employee answered, but the deterministic core could not derive
      // a structured fact. Retain the answer for this category so the
      // question is never asked again (never knowingly ask twice).
      recordAnswer(context, pending, text.trim());
    }
    return this.advanceIntake();
  }

  /** Ask the next missing category or complete the context into the preview. */
  private advanceIntake(): readonly ChatMessage[] {
    const context = this.requireContext();
    const missing = calculateMissingFacts(context, FICTIONAL_REQUIREMENT_RULES).missing;
    const category = missing[0];
    if (category !== undefined) {
      context.pendingIntakeCategory = category;
      return [{ role: 'elvie', text: FACT_QUESTIONS[category] }];
    }
    applyTransition(context, 'COMPLETE_CONTEXT');
    applyTransition(context, 'PREVIEW');
    return this.previewMessages();
  }

  // --- Preview and submission -----------------------------------------------

  /**
   * Employee-facing preview; explicitly and unambiguously marked as a
   * simulation (BUILD_03.md v5.2 par. 9.2).
   */
  private previewMessages(): readonly ChatMessage[] {
    const context = this.requireContext();
    const lines: string[] = [];
    const subject = contextValue(context, 'serviceOrApplication');
    const device = contextValue(context, 'device');
    const symptom = contextValue(context, 'symptom');
    const requestedResource = contextValue(context, 'requestedResource');
    const location = contextValue(context, 'location');
    const indicators = contextValue(context, 'securityIndicators');
    if (subject !== undefined) {
      lines.push('Onderwerp: ' + subject);
    }
    if (device !== undefined) {
      lines.push('Apparaat: ' + device);
    }
    if (symptom !== undefined) {
      lines.push('Symptoom: ' + symptom);
    }
    if (requestedResource !== undefined) {
      lines.push('Aanvraag: ' + requestedResource);
    }
    if (location !== undefined) {
      lines.push('Locatie: ' + location);
    }
    if (indicators !== undefined) {
      lines.push('Beveiligingsindicatoren: ' + indicators);
    }
    const intro = this.texts.previewIntro.replace('melding', intakeLabel(context));
    const messages: ChatMessage[] = [];
    if (lines.length > 0) {
      messages.push({ role: 'elvie', text: lines.join('\n') });
    }
    messages.push({ role: 'elvie', text: intro });
    return messages;
  }

  /**
   * PREVIEW. The submission is sent only after the employee explicitly
   * confirms. When the outcome is uncertain (inconclusive), new
   * 'versturen'/'bevestigen' input NEVER triggers a second submit:
   * recovery happens exclusively via a status check with the same
   * submission key (BUILD_03.md v5.2 par. 11/12).
   */
  private async handlePreview(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const answer = text.trim().toLowerCase();
    const submission = context.submission;

    if (submission.status === 'inconclusive') {
      if (isSubmissionConfirmation(answer) || answer.includes('status')) {
        return this.checkSubmissionStatus();
      }
      return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
    }

    if (submission.status === 'failed') {
      // A new attempt requires an explicit new confirmation; a new turn
      // then also produces a new submission key (par. 11).
      if (isSubmissionConfirmation(answer)) {
        return this.submitTicket();
      }
      return [{ role: 'elvie', text: this.texts.submissionFailed }];
    }

    if (!isSubmissionConfirmation(answer)) {
      return [{ role: 'elvie', text: this.texts.previewConfirmPrompt }];
    }
    return this.submitTicket();
  }

  /**
   * Deferred SUBMIT transition: the ticket port is called BEFORE any
   * lifecycle transition (par. 12.1). Only a contract-valid submitted
   * result reaches CONFIRM; failed, unknown, invalid and exception
   * outcomes all keep the conversation in PREVIEW (par. 12.2).
   */
  private async submitTicket(): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const submission = context.submission;
    submission.attempt += 1;
    const key = makeSubmissionKey(context.sessionId, submission.attempt);
    submission.key = key.value;
    submission.status = 'confirmed';

    const draft: TicketDraft = { ...buildTicketDraft(context), submissionKey: key };
    let result: TicketSubmissionResult;
    try {
      result = await this.deps.ticket.submit(draft);
    } catch (error) {
      // Timeout / network interruption / unknown transport failure:
      // the outcome is inconclusive; never resubmit automatically.
      submission.status = 'inconclusive';
      this.auditSubmission('inconclusive', 'transport');
      this.operational('error', 'ticket submission inconclusive', 'failure', 'transport');
      void error;
      return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
    }

    if (!isContractValidSubmission(result, key)) {
      // Invalid or contradictory response: NEVER reaches CONFIRM; handled
      // fail-closed as uncertain (par. 10.1).
      submission.status = 'inconclusive';
      this.auditSubmission('inconclusive', 'submission_contract_violation');
      this.operational(
        'error',
        'ticket submission contract violation',
        'failure',
        'submission_contract_violation',
      );
      return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
    }

    if (result.kind === 'submitted') {
      submission.status = 'submitted';
      submission.reference = result.reference;
      applyTransition(context, 'SUBMIT');
      applyTransition(context, 'CONFIRM');
      this.auditSubmission('success', undefined, result.reference);
      this.operational('info', 'ticket submitted (simulated)', 'success');
      return [{ role: 'elvie', text: this.texts.submissionSuccess.replace('REFERENTIE', result.reference) }];
    }

    if (result.kind === 'failed') {
      submission.status = 'failed';
      this.auditSubmission('failed', result.reasonCategory);
      this.operational('error', 'ticket submission failed', 'failure', result.reasonCategory);
      return [{ role: 'elvie', text: this.texts.submissionFailed }];
    }

    // result.kind === 'unknown' (valid): uncertain outcome, stays in PREVIEW.
    submission.status = 'inconclusive';
    this.auditSubmission('inconclusive', result.reasonCategory);
    this.operational('error', 'ticket submission inconclusive', 'failure', result.reasonCategory);
    return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
  }

  /**
   * Recovery for an uncertain outcome (par. 11/12.2): a status check with
   * the SAME key; never a second submit. A valid submitted status
   * completes PREVIEW -> SUBMIT -> CONFIRM with the existing fictitious
   * reference. A valid unknown status, an invalid/contradictory status
   * response and a status-check exception all keep the outcome
   * inconclusive.
   */
  private async checkSubmissionStatus(): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const submission = context.submission;
    const key: SubmissionKey = { value: submission.key ?? '' };
    let status;
    try {
      status = await this.deps.ticket.getStatus(key);
    } catch (error) {
      this.operational(
        'error',
        'ticket status check failed',
        'failure',
        error instanceof Error ? error.name : 'unknown',
      );
      return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
    }

    if (!isContractValidStatus(status, key)) {
      // Invalid or contradictory status response: fail-closed, never CONFIRM.
      this.auditSubmission('inconclusive', 'submission_contract_violation');
      this.operational(
        'error',
        'ticket status contract violation',
        'failure',
        'submission_contract_violation',
      );
      return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
    }

    if (status.kind === 'submitted') {
      submission.status = 'submitted';
      submission.reference = status.reference;
      applyTransition(context, 'SUBMIT');
      applyTransition(context, 'CONFIRM');
      this.auditSubmission('success', undefined, status.reference);
      this.operational('info', 'ticket status resolved as submitted (simulated)', 'success');
      return [{ role: 'elvie', text: this.texts.submissionSuccess.replace('REFERENTIE', status.reference) }];
    }

    // Valid unknown status: the outcome stays uncertain, still PREVIEW.
    return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
  }

  // --- Helpers ------------------------------------------------------------

  private requireContext(): ConversationContext {
    if (this.context === null) {
      throw new Error('Conversation not started');
    }
    return this.context;
  }

  /**
   * Audit event for the ticket submission lifecycle (par. 12.3): event
   * type ticket_submission with outcomes success | failed | inconclusive,
   * safe categories only, no content, no sensitive values.
   */
  private auditSubmission(
    outcome: 'success' | 'failed' | 'inconclusive',
    reason?: string,
    targetId?: string,
  ): void {
    const context = this.context;
    this.auditSafe(
      createAuditEvent({
        eventType: 'ticket_submission',
        actorId: this.actorId,
        action: 'submit_ticket',
        targetType: 'ticket',
        targetId,
        outcome,
        correlationId: context?.sessionId ?? 'none',
        component: COMPONENT_CONVERSATION_ENGINE,
        reason,
        appVersion: APP_VERSION,
      }),
    );
  }

  private operational(
    level: 'info' | 'warn' | 'error',
    message: string,
    outcome: 'success' | 'failure',
    errorCategory?: string,
  ): void {
    this.deps.operational.log({
      timestamp: nowIso(),
      level,
      component: COMPONENT_CONVERSATION_ENGINE,
      correlationId: this.context?.sessionId ?? 'none',
      message,
      outcome,
      errorCategory,
    });
  }

  /** Record audit events without letting an unconfigured sink break the flow. */
  private auditSafe(event: AuditEvent): void {
    try {
      this.deps.audit.record(event);
    } catch (error) {
      this.operational('error', 'audit sink failed', 'failure', error instanceof Error ? error.name : 'unknown');
    }
  }
}

// --- Module helpers ---------------------------------------------------------

/**
 * Deterministic feedback classification. 'niet opgelost' variants are
 * checked FIRST: 'niet opgelost' contains the substring 'opgelost'.
 */
function classifyResolutionFeedback(text: string): ResolutionFeedback | undefined {
  const answer = text.trim().toLowerCase();
  if (/(^|[^a-z])niet opgelost|helpt niet|lukt niet|^nee\b|^no\b/.test(answer)) {
    return 'niet_opgelost';
  }
  if (/\bopgelost\b|\bgelukt\b|^ja\b|^yes\b|werkt weer/.test(answer)) {
    return 'opgelost';
  }
  if (/onduidelijk|weet niet|geen idee|snap het niet|snap er niets van|twijfel/.test(answer)) {
    return 'onduidelijk';
  }
  return undefined;
}

/**
 * Deterministic submission confirmation words (par. 12.1: every submit
 * requires an explicit confirmation; a failed retry needs a NEW turn and
 * therefore a new key).
 */
function isSubmissionConfirmation(answer: string): boolean {
  return (
    answer === 'bevestig' ||
    answer === 'bevestigen' ||
    answer === 'verstuur' ||
    answer === 'versturen' ||
    answer === 'verzend' ||
    answer === 'verzenden' ||
    answer === 'ja' ||
    answer === 'yes'
  );
}

function intakeLabel(context: ConversationContext): string {
  switch (context.intakeType) {
    case 'request':
      return 'aanvraag';
    case 'security':
      return 'beveiligingsmelding';
    default:
      return 'melding';
  }
}

/** Structured context value for previews and drafts (fact first, answer second). */
function contextValue(context: ConversationContext, category: FactCategory): string | undefined {
  const fact = getFact(context, category)?.value;
  if (fact !== undefined) {
    return fact;
  }
  const answer: ConversationFactValue | undefined = getAnswer(context, category);
  if (answer === undefined) {
    return undefined;
  }
  if (typeof answer === 'string') {
    return answer;
  }
  if (typeof answer === 'number' || typeof answer === 'boolean') {
    return String(answer);
  }
  return answer.join(', ');
}

function buildTicketDraft(context: ConversationContext): TicketDraft {
  const category = context.intakeType ?? 'incident';
  const subject = contextValue(context, 'serviceOrApplication') ?? contextValue(context, 'device');
  const requestedResource = contextValue(context, 'requestedResource');
  const symptom = contextValue(context, 'symptom');
  const location = contextValue(context, 'location');
  const indicators = contextValue(context, 'securityIndicators');

  const summaryParts: string[] = [category];
  if (subject !== undefined) {
    summaryParts.push(subject);
  } else if (requestedResource !== undefined) {
    summaryParts.push(requestedResource);
  }
  if (symptom !== undefined) {
    summaryParts.push(symptom);
  }

  const ticketContext: Record<string, string> = {
    intent: context.intentClassification?.value ?? context.intent ?? 'unknown',
  };
  if (subject !== undefined) {
    ticketContext['onderwerp'] = subject;
  }
  if (requestedResource !== undefined) {
    ticketContext['aanvraag'] = requestedResource;
  }
  if (symptom !== undefined) {
    ticketContext['symptoom'] = symptom;
  }
  if (location !== undefined) {
    ticketContext['locatie'] = location;
  }
  if (indicators !== undefined) {
    ticketContext['beveiligingsindicatoren'] = indicators;
  }

  return {
    category,
    summary: summaryParts.join(' — '),
    description: 'Vastgelegd door Elvie op basis van bekende gespreksfeiten (simulatie).',
    context: ticketContext,
    submissionKey: { value: '' },
  };
}

/**
 * Fixed article presentation (BUILD_03.md v5.2 par. 6): title, ordered
 * steps and the source citation. The citation names the fictitious mock
 * source; it is a catalogue reference, never a registration claim.
 */
function renderArticle(article: KnowledgeArticle): string {
  const lines = [article.title];
  if (article.steps.length > 0) {
    lines.push('Stappen:');
    for (const step of article.steps) {
      lines.push('- ' + step);
    }
  }
  lines.push('Bron: TOPdesk Kennisbank — ' + article.sourceReference);
  return lines.join('\n');
}
