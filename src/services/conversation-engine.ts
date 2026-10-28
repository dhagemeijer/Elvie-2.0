import type { ConversationContext, ConversationStateName, IntakeType } from '../domain/conversation-context';
import { classifyAnswerOutcome, clearAnswerOutcome, recordAnswerOutcome } from '../domain/answer-outcome';
import { UNKNOWN_LABEL, validateIntake, type IntakeValidationResult } from '../domain/intake-policy';
import { buildDraftFromContent, buildTicketContent, type TicketContent } from '../domain/ticket-content';
import { createConversationContext, hasReliableFact, recordAnswer } from '../domain/conversation-context';
import type { FactCategory } from '../domain/facts';
import { processEmployeeMessage } from '../domain/conversation-core';
import { FACT_QUESTIONS } from '../domain/conversation-decision';
import { buildKnowledgeQuery } from '../domain/knowledge-request';
import { gateKnowledgeArticles, rankKnowledgeArticles, type RankedKnowledgeArticle } from '../domain/knowledge-ranking';
import { materialStateProjection, nextMaterialRevision } from '../domain/material-revision';
import {
  computeRouting,
  ROUTING_CLARIFICATION_QUESTIONS,
  routingMaterialFingerprint,
  type RoutingClarificationBookkeeping,
  type RoutingResult,
} from '../domain/routing';
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
  readonly knowledgeDependencyIntake: string;
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
  knowledgeDependencyIntake:
    'De kennisvoorziening blijft voor nu onbeschikbaar. We kunnen je situatie vastleggen in deze simulatie.',
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
 * BUILD 04C §15.4: internal preview subphases within the existing PREVIEW
 * lifecycle state (never new top-level states).
 */
type PreviewSubphase =
  | 'awaiting_confirmation'
  | 'editing'
  | 'awaiting_correction_answer'
  | 'revalidating'
  | 'submission_locked';

/**
 * BUILD 04C §7.2: immutable, server-owned preview snapshot. Coupled to the
 * server-owned material revision from Build 04A: any material change bumps
 * the revision and thereby invalidates the snapshot automatically.
 */
interface PreviewSnapshot {
  readonly content: TicketContent;
  readonly validation: IntakeValidationResult;
  readonly revision: number;
}

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

  /** Build 04A: latest functional routing result (internal; no lifecycle effect). */
  private routing: RoutingResult | null = null;

  /** Build 04A: one-question routing clarification budget bookkeeping. */
  private routingClarification: RoutingClarificationBookkeeping = { materialFingerprint: '' };

  /** Build 04A §15.3: server-owned material revision (one bump per material change). */
  private materialRevision = 0;

  /** Build 04A §15.3: canonical material-state signature after the last accepted turn. */
  private materialSignature = '';

  /** Build 04A §15.3: per-session serialisation of routing updates. */
  private routingUpdateChain: Promise<void> = Promise.resolve();

  /** Build 04A §15.3 final: serialises complete employee message processing per session. */
  private messageProcessingChain: Promise<unknown> = Promise.resolve();

  /** Build 04C §15.4: internal preview subphase (never a lifecycle state). */
  private previewSubphase: PreviewSubphase = 'awaiting_confirmation';

  /** Build 04C §7.2: immutable server-owned preview snapshot (or null). */
  private previewSnapshot: PreviewSnapshot | null = null;

  /** Build 04C §15.5: in-flight submission claim (defense in depth). */
  private submissionInFlight = false;

  /** Build 04B §6.3: bounded per-field clarification bookkeeping. */
  private clarifiedFields = new Set<string>();

  /** Build 04C: field of an open correction question (if any). */
  private pendingCorrectionField: FactCategory | null = null;

  /** Build 04B/04C: latest intake validation result (diagnostics/tests). */
  private lastValidation: IntakeValidationResult | null = null;

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
   * Build 04A: latest functional routing result for diagnostics/tests; null
   * before the first processed employee message. Purely informative in this
   * build: routing never changes messages, decisions or lifecycle state.
   */
  public get currentRouting(): RoutingResult | null {
    return this.routing;
  }

  /**
   * Build 04A §15.3: server-owned material revision for diagnostics/tests.
   * Starts at 0 and rises exactly once per material context change.
   */
  public get currentMaterialRevision(): number {
    return this.materialRevision;
  }

  /**
   * Build 04C §7.2: current immutable preview snapshot for
   * diagnostics/tests (null before the first preview).
   */
  public get currentPreviewSnapshot(): PreviewSnapshot | null {
    return this.previewSnapshot;
  }

  /** Build 04B: latest intake validation result (diagnostics/tests). */
  public get currentIntakeValidation(): IntakeValidationResult | null {
    return this.lastValidation;
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
      this.routing = null;
      this.routingClarification = { materialFingerprint: '' };
      this.materialRevision = 0;
      this.materialSignature = this.materialSignatureAfter(this.context);
      this.routingUpdateChain = Promise.resolve();
      this.messageProcessingChain = Promise.resolve();
      this.previewSubphase = 'awaiting_confirmation';
      this.previewSnapshot = null;
      this.submissionInFlight = false;
      this.clarifiedFields.clear();
      this.pendingCorrectionField = null;
      this.lastValidation = null;
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

  /**
   * Handle one line of employee input, deterministically per current
   * state. BUILD 04A §15.3 final remediation: the COMPLETE employee
   * message processing is serialised per session, so concurrent messages
   * can never interleave context mutations, material revision
   * determination or routing decisions within one session.
   */
  handleEmployeeInput(text: string): Promise<readonly ChatMessage[]> {
    const process = (): Promise<readonly ChatMessage[]> => this.processEmployeeTurn(text);
    const chained = this.messageProcessingChain.then(process, process);
    this.messageProcessingChain = chained.then(
      () => undefined,
      () => undefined,
    );
    return chained;
  }

  private async processEmployeeTurn(text: string): Promise<readonly ChatMessage[]> {
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
    // BUILD 04B par. 15.1/15.3: the engine-owned ticket category is material
    // state and is fixed WITHIN the turn that derives it, so the central
    // turn commit compares like with like and a category change is never
    // attributed to a later, materially unchanged turn.
    if (decision.kind === 'security_sensitive_route') {
      context.intakeType = 'security';
    } else if (decision.kind === 'sufficient_understanding') {
      context.intakeType =
        (context.intentClassification?.value ?? context.intent) === 'request' ? 'request' : 'incident';
    }
    await this.enqueueRoutingUpdate(text);
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
      case 'sufficient_understanding': {
        // BUILD 04A §5.2 remediation: when routing needs its ONE targeted
        // question, it is shown here and the conversation stays in
        // UNDERSTAND; the deterministic core keeps priority with its own
        // questions and a security-sensitive route always stays leading.
        const routingQuestion = this.pendingRoutingQuestion();
        if (routingQuestion !== undefined) {
          return [routingQuestion];
        }
        return this.searchKnowledge();
      }
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
          return this.goToIntake(this.texts.knowledgeDependencyIntake);
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
  private async handleResolutionClarification(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const feedback = classifyResolutionFeedback(text);
    if (feedback !== undefined) {
      return this.handleResolutionFeedback(text);
    }
    processEmployeeMessage(context, text);
    await this.enqueueRoutingUpdate(text);
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
    const question = this.nextIntakeQuestion();
    if (question !== undefined) {
      return [{ role: 'elvie', text: intro }, { role: 'elvie', text: question.text }];
    }
    // Everything required is already reliably validated: complete the
    // context and show the preview without asking anything twice.
    applyTransition(context, 'COMPLETE_CONTEXT');
    applyTransition(context, 'PREVIEW');
    return [{ role: 'elvie', text: intro }, ...this.renderPreview()];
  }

  // --- Generic intake -------------------------------------------------------

  /**
   * INTAKE: process the answer through the Build 02 core (so known facts
   * are reused), retain answers the core cannot structure (never ask
   * twice), and ask only for the next genuinely missing category.
   */
  private handleIntake(text: string): Promise<readonly ChatMessage[]> {
    return this.processIntakeAnswer(text);
  }

  private handleCompleteContext(text: string): Promise<readonly ChatMessage[]> {
    return this.processIntakeAnswer(text);
  }

  private async processIntakeAnswer(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const pending = context.pendingIntakeCategory;
    processEmployeeMessage(context, text);
    context.pendingIntakeCategory = undefined;
    if (pending !== undefined) {
      if (hasReliableFact(context, pending)) {
        // I-08: a structured fact derived from this answer supersedes any
        // earlier typed outcome for the same field.
        clearAnswerOutcome(context, pending);
      } else {
        // BUILD 04B §15.2: the deterministic core could not derive a
        // structured fact. Classify the answer into a typed outcome and
        // retain that outcome: raw free text is never automatically
        // treated as validated, an accepted explicit unknown completes a
        // required-answer field, an invalid answer gets a bounded retry.
        recordAnswerOutcome(context, pending, classifyAnswerOutcome(text, context.currentTurn));
      }
    }
    // §15.3: the turn commit runs AFTER the validated answer is retained,
    // so the material revision rises in the turn that produced it.
    await this.enqueueRoutingUpdate(text);
    return this.advanceIntake();
  }

  /** Ask the next unresolved required field or complete into the preview. */
  private advanceIntake(): readonly ChatMessage[] {
    const context = this.requireContext();
    const question = this.nextIntakeQuestion();
    if (question !== undefined) {
      return [{ role: 'elvie', text: question.text }];
    }
    applyTransition(context, 'COMPLETE_CONTEXT');
    applyTransition(context, 'PREVIEW');
    return this.renderPreview();
  }

  /**
   * BUILD 04B §6.3/§15.2: next intake question, if any. Validation runs
   * from the SINGLE engine-owned effective ticket category plus the
   * functional route (§6.1). A missing required field is asked; a field
   * with an accepted explicit unknown is never asked again; an invalid
   * answer gets exactly one bounded clarification (I-03/I-05).
   */
  private nextIntakeQuestion(): { field: FactCategory; text: string } | undefined {
    const context = this.requireContext();
    // F-06/I-10: a security report always takes the safe security route and
    // is never blocked or interrogated: the safe handover has priority.
    if (this.intakeCategory() === 'security') {
      return undefined;
    }
    const validation = validateIntake(context, this.intakeCategory(), this.functionalRoute());
    this.lastValidation = validation;
    const missingField = validation.fields.find((field) => field.status === 'missing');
    if (missingField !== undefined) {
      context.pendingIntakeCategory = missingField.field;
      return { field: missingField.field, text: FACT_QUESTIONS[missingField.field] };
    }
    const retryable = validation.fields.find(
      (field) => field.status === 'invalid' && !this.clarifiedFields.has(field.field),
    );
    if (retryable !== undefined) {
      this.clarifiedFields.add(retryable.field);
      context.pendingIntakeCategory = retryable.field;
      return {
        field: retryable.field,
        text: 'Ik begrijp dat antwoord niet helemaal. ' + FACT_QUESTIONS[retryable.field],
      };
    }
    return undefined;
  }

  /** Build 04B §6.1: the single engine-owned effective ticket category. */
  private intakeCategory(): IntakeType {
    const context = this.requireContext();
    return context.intakeType ?? 'incident';
  }

  /** Build 04A/04C: current functional route ('unknown' while undetermined). */
  private functionalRoute(): string {
    const routing = this.routing;
    return routing !== null && routing.status === 'determined' ? routing.route : 'unknown';
  }

  // --- Preview and submission -----------------------------------------------

  /**
   * BUILD 04C §7.2: build the canonical validated ticket content and pin
   * the immutable, server-owned preview snapshot, coupled to the current
   * material revision. Any material change bumps the revision and thereby
   * invalidates this snapshot automatically (P-03).
   */
  private renderPreview(): readonly ChatMessage[] {
    const context = this.requireContext();
    const validation = validateIntake(context, this.intakeCategory(), this.functionalRoute());
    this.lastValidation = validation;
    const content = buildTicketContent(context, this.intakeCategory(), this.functionalRoute(), validation);
    this.previewSnapshot = { content, validation, revision: this.materialRevision };
    this.previewSubphase = 'awaiting_confirmation';
    return this.previewMessages();
  }

  /**
   * Employee-facing preview, rendered strictly FROM the immutable
   * snapshot (BUILD_04 §7.2.3); explicitly and unambiguously marked as a
   * simulation (P-10). Required fields with an accepted explicit unknown
   * are shown as such (I-15) and derived values are never presented as
   * explicit statements (P-02).
   */
  private previewMessages(): readonly ChatMessage[] {
    const snapshot = this.previewSnapshot;
    if (snapshot === null) {
      return [];
    }
    const lines: string[] = [];
    lines.push('Categorie: ' + categoryLabel(snapshot.content.category));
    lines.push(
      snapshot.content.route === 'unknown'
        ? 'Functionele route: onbekend (intern)'
        : 'Functionele route: ' + snapshot.content.route + ' (intern, geen TOPdesk-toewijzing)',
    );
    for (const [key, label] of PREVIEW_FIELD_LABELS) {
      const value = snapshot.content.context[key];
      if (value !== undefined) {
        lines.push(label + ': ' + value + (snapshot.content.provenance[key] === 'afgeleid' ? ' (afgeleid)' : ''));
      }
    }
    for (const field of snapshot.content.unknownFields) {
      const label = FIELD_LABELS[field];
      if (label !== undefined) {
        lines.push(label + ': ' + UNKNOWN_LABEL);
      }
    }
    const intro = this.texts.previewIntro.replace('melding', categoryLabel(snapshot.content.category));
    const messages: ChatMessage[] = [];
    if (lines.length > 0) {
      messages.push({ role: 'elvie', text: lines.join('\n') });
    }
    messages.push({ role: 'elvie', text: intro });
    if (
      snapshot.validation.outcome === 'needs_information' ||
      snapshot.validation.outcome === 'clarification_required'
    ) {
      messages.push({
        role: 'elvie',
        text: 'Belangrijk: deze melding is nog niet volledig gevalideerd. Bevestigen of versturen is daarom nog niet mogelijk; vul ontbrekende informatie aan via een beschrijving van wat je wilt aanpassen.',
      });
    }
    return messages;
  }

  /**
   * PREVIEW (BUILD_04C §7.2/§15.4/§16.3). Submission happens only after an
   * exact confirmation command in the awaiting_confirmation subphase with
   * a current, validated snapshot. Corrections edit the underlying data
   * within the existing PREVIEW lifecycle state; a correction answer (and
   * 'ja' during editing or a correction answer) is never a submission
   * (F-10/P-09). An uncertain (inconclusive) outcome recovers exclusively
   * via a status check with the same submission key; a failed attempt
   * requires a fresh validated preview and a NEW explicit confirmation.
   */
  private async handlePreview(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const answer = text.trim().toLowerCase();
    const submission = context.submission;

    // §15.5: an in-flight submission claim can never produce a second
    // logical attempt, submission key or submit() call.
    if (this.submissionInFlight) {
      return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
    }

    if (submission.status === 'inconclusive') {
      if (isSubmissionConfirmation(answer) || answer.includes('status')) {
        return this.checkSubmissionStatus();
      }
      // F-12: no correction mutates a claimed draft while uncertain.
      return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
    }

    if (submission.status === 'failed') {
      // S-08/S-18/P-11 (par. 15.5): a new attempt requires a fresh explicit
      // confirmation of a current validated preview; an unchanged draft may
      // be retried after that explicit reconfirmation. A stale or unresolved
      // snapshot can still never submit: it is re-rendered instead.
      if (isSubmissionConfirmation(answer)) {
        if (this.snapshotIsCurrent()) {
          return this.submitTicket();
        }
        return this.renderPreview();
      }
      return [{ role: 'elvie', text: this.texts.submissionFailed }];
    }

    // F-10/P-09: while a correction question is open, every input
    // (including exact confirmation words) is an answer to that question,
    // never a submission.
    if (this.previewSubphase === 'awaiting_correction_answer') {
      return this.handleCorrectionAnswer(text);
    }

    if (isSubmissionConfirmation(answer)) {
      if (this.previewSubphase === 'awaiting_confirmation' && this.snapshotIsCurrent()) {
        return this.submitTicket();
      }
      // P-07/P-08/I-06: a stale snapshot or unresolved validation can
      // never submit; the fresh validated preview is shown instead.
      return this.renderPreview();
    }

    // P-12: any other input corrects the underlying data.
    return this.handlePreviewCorrection(text);
  }

  /**
   * §7.2.4: the snapshot is current when its revision matches the
   * server-owned material revision and its validation admits a preview
   * confirmation.
   */
  private snapshotIsCurrent(): boolean {
    const snapshot = this.previewSnapshot;
    if (snapshot === null || snapshot.revision !== this.materialRevision) {
      return false;
    }
    return (
      snapshot.validation.outcome === 'ready_for_preview' ||
      snapshot.validation.outcome === 'security_route_required'
    );
  }

  /**
   * P-12: process a correction of the underlying data inside the existing
   * PREVIEW state. The turn commit runs after the correction, so a
   * material correction bumps the revision exactly once and thereby
   * invalidates the previous snapshot automatically (P-03/P-05).
   */
  private async handlePreviewCorrection(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    this.previewSubphase = 'editing';
    this.pendingCorrectionField = null;
    processEmployeeMessage(context, text);
    await this.enqueueRoutingUpdate(text);
    this.operational('info', 'preview correction processed', 'success');
    return this.completeCorrection();
  }

  /** F-10: the answer to an open correction question, typed like intake. */
  private async handleCorrectionAnswer(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const pending = this.pendingCorrectionField;
    this.pendingCorrectionField = null;
    processEmployeeMessage(context, text);
    if (pending !== null && !hasReliableFact(context, pending)) {
      recordAnswerOutcome(context, pending, classifyAnswerOutcome(text, context.currentTurn));
    } else if (pending !== null) {
      clearAnswerOutcome(context, pending);
    }
    await this.enqueueRoutingUpdate(text);
    return this.completeCorrection();
  }

  /**
   * P-04: after a correction, revalidate and re-route: a still-unresolved
   * required field gets exactly one bounded follow-up question within the
   * existing PREVIEW state; otherwise the freshly validated preview is
   * shown again and awaits a new explicit confirmation.
   */
  private completeCorrection(): readonly ChatMessage[] {
    const context = this.requireContext();
    const next = this.nextIntakeQuestion();
    context.pendingIntakeCategory = undefined;
    if (next !== undefined) {
      this.previewSubphase = 'awaiting_correction_answer';
      this.pendingCorrectionField = next.field;
      return [{ role: 'elvie', text: 'Bedankt. Nog één aanvulling:' }, { role: 'elvie', text: next.text }];
    }
    this.previewSubphase = 'revalidating';
    return [
      { role: 'elvie', text: 'Ik heb je aanpassing verwerkt. Dit is de bijgewerkte melding.' },
      ...this.renderPreview(),
    ];
  }

  /**
   * Deferred SUBMIT transition (par. 12.1) with BUILD_04C §7.2.4/§15.5:
   * server-side revalidation immediately before the port call — a stale
   * snapshot, unresolved validation or drifted content never submits; the
   * draft submitted is EXACTLY the confirmed snapshot content (P-13). The
   * logical attempt is claimed atomically BEFORE awaiting the port, so a
   * concurrent confirmation can never create a second attempt or key.
   * Only a contract-valid submitted result reaches CONFIRM; failed,
   * unknown, invalid and exception outcomes all keep the conversation in
   * PREVIEW (par. 12.2).
   */
  private async submitTicket(): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const submission = context.submission;
    const snapshot = this.previewSnapshot;

    // §7.2.4/§15.3: a superseded (stale) snapshot can never submit.
    if (snapshot === null || snapshot.revision !== this.materialRevision) {
      return this.renderPreview();
    }
    const freshValidation = validateIntake(context, this.intakeCategory(), this.functionalRoute());
    this.lastValidation = freshValidation;
    if (freshValidation.outcome === 'needs_information' || freshValidation.outcome === 'clarification_required') {
      // I-06/P-08: essential information missing or contradictory: never
      // submit, never a false completion.
      this.previewSnapshot = { content: snapshot.content, validation: freshValidation, revision: snapshot.revision };
      this.previewSubphase = 'awaiting_confirmation';
      return this.previewMessages();
    }
    const freshContent = buildTicketContent(context, this.intakeCategory(), this.functionalRoute(), freshValidation);
    if (JSON.stringify(freshContent) !== JSON.stringify(snapshot.content)) {
      // P-11/P-13: any drift between the confirmed snapshot and the
      // current validated content re-renders a fresh preview instead.
      this.previewSnapshot = { content: freshContent, validation: freshValidation, revision: this.materialRevision };
      this.previewSubphase = 'awaiting_confirmation';
      return this.previewMessages();
    }

    this.submissionInFlight = true;
    try {
      const key = makeSubmissionKey(context.sessionId, submission.attempt + 1);
      submission.key = key.value;
      submission.status = 'confirmed';
      const draft: TicketDraft = buildDraftFromContent(snapshot.content, key);
      let result: TicketSubmissionResult;
      try {
        result = await this.deps.ticket.submit(draft);
      } catch (error) {
        submission.attempt += 1;
        submission.status = 'inconclusive';
        this.auditSubmission('inconclusive', 'transport');
        this.operational('error', 'ticket submission inconclusive', 'failure', 'transport');
        void error;
        return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
      }
      if (!isContractValidSubmission(result, key)) {
        submission.attempt += 1;
        submission.status = 'inconclusive';
        this.auditSubmission('inconclusive', 'submission_contract_violation');
        this.operational('error', 'ticket submission contract violation', 'failure', 'submission_contract_violation');
        return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
      }
      if (result.kind === 'submitted') {
        submission.attempt += 1;
        submission.status = 'submitted';
        submission.reference = result.reference;
        applyTransition(context, 'SUBMIT');
        applyTransition(context, 'CONFIRM');
        this.auditSubmission('success', undefined, result.reference);
        this.operational('info', 'ticket submitted (simulated)', 'success');
        return [{ role: 'elvie', text: this.texts.submissionSuccess.replace('REFERENTIE', result.reference) }];
      }
      if (result.kind === 'failed') {
        submission.attempt += 1;
        submission.status = 'failed';
        this.auditSubmission('failed', result.reasonCategory);
        this.operational('error', 'ticket submission failed', 'failure', result.reasonCategory);
        return [{ role: 'elvie', text: this.texts.submissionFailed }];
      }
      // result.kind === 'unknown' (valid): uncertain outcome, stays in PREVIEW.
      submission.attempt += 1;
      submission.status = 'inconclusive';
      this.auditSubmission('inconclusive', result.reasonCategory);
      this.operational('error', 'ticket submission inconclusive', 'failure', result.reasonCategory);
      return [{ role: 'elvie', text: this.texts.submissionInconclusive }];
    } finally {
      this.submissionInFlight = false;
    }
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
   * §15.3 final: canonical FULL material-state signature of the context,
   * including the budget-independent routing decision it implies.
   */
  private materialSignatureAfter(context: ConversationContext): string {
    return materialStateProjection(context, this.routingDecisionOf(context));
  }

  /**
   * §15.3: routing decision implied by the material context ALONE:
   * computed without clarification bookkeeping, so a spent clarification
   * budget never masquerades as a material change.
   */
  private routingDecisionOf(context: ConversationContext): string {
    const snapshot = computeRouting(context, { rawInput: '' });
    if (snapshot.status === 'determined') {
      return snapshot.route + '~' + snapshot.ruleIds.join(',');
    }
    if (snapshot.status === 'clarification_required') {
      return snapshot.status + '~' + snapshot.questionCode;
    }
    return snapshot.status + '~' + snapshot.reasonCode;
  }

  /**
   * Build 04A: recompute the functional routing after the deterministic
   * core processed a message. Internal/diagnostic in this build: the
   * result never changes lifecycle state or the existing decision flow.
   */
  private updateRouting(text: string): void {
    const context = this.context;
    if (context === null) {
      return;
    }
    this.routing = computeRouting(context, {
      rawInput: text,
      materialRevision: this.materialRevision,
      clarification: this.routingClarification,
    });
  }

  /**
   * Build 04A §15.3 final remediation: central, server-owned material
   * revision. Compares the canonical FULL material-state projection before
   * (the signature after the last accepted turn) and after the accepted
   * turn: the revision rises exactly once per material change and never
   * for administrative bookkeeping alone (identical material states keep
   * the revision). Runs inside the serialised per-session turn processing.
   */
  private enqueueRoutingUpdate(text: string): Promise<void> {
    const run = (): void => {
      const context = this.context;
      if (context === null) {
        return;
      }
      const after = this.materialSignatureAfter(context);
      this.materialRevision = nextMaterialRevision(this.materialSignature, after, this.materialRevision);
      this.materialSignature = after;
      this.updateRouting(text);
    };
    const chained = this.routingUpdateChain.then(run, run);
    this.routingUpdateChain = chained;
    return chained;
  }

  /**
   * Build 04A §5.2/§15.3 remediation: the ONE targeted routing question,
   * shown only when the deterministic core itself needs no question and
   * the routing budget allows it. The budget is recorded exactly at the
   * moment the question is actually shown, coupled to the current
   * server-owned material revision; an answer adding no material evidence
   * never resets the budget. Returns undefined when no question may be
   * asked (the ordinary flow then continues undisturbed).
   */
  private pendingRoutingQuestion(): ChatMessage | undefined {
    const context = this.context;
    const routing = this.routing;
    if (context === null || routing === null || routing.status !== 'clarification_required') {
      return undefined;
    }
    const questionText = ROUTING_CLARIFICATION_QUESTIONS[routing.questionCode];
    if (questionText === undefined) {
      return undefined;
    }
    this.routingClarification = {
      questionCode: routing.questionCode,
      materialFingerprint: routingMaterialFingerprint(context),
      materialRevisionAtQuestion: this.materialRevision,
    };
    this.operational('info', 'routing clarification asked', 'success', routing.questionCode);
    return { role: 'elvie', text: questionText };
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

/** Build 04C §7.2.3: field display labels (preview and unknown lines). */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  symptom: 'Symptoom',
  serviceOrApplication: 'Onderwerp',
  device: 'Apparaat',
  requestedResource: 'Aanvraag',
  location: 'Locatie',
  securityIndicators: 'Beveiligingsindicatoren',
  startTime: 'Begintijd',
  impact: 'Impact',
};

/** Preview render order for the validated content fields. */
const PREVIEW_FIELD_LABELS: readonly (readonly [string, string])[] = [
  ['onderwerp', 'Onderwerp'],
  ['apparaat', 'Apparaat'],
  ['symptoom', 'Symptoom'],
  ['aanvraag', 'Aanvraag'],
  ['locatie', 'Locatie'],
  ['beveiligingsindicatoren', 'Beveiligingsindicatoren'],
];

function categoryLabel(category: IntakeType): string {
  switch (category) {
    case 'request':
      return 'aanvraag';
    case 'security':
      return 'beveiligingsmelding';
    default:
      return 'melding';
  }
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
