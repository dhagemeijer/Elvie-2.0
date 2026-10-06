import type { ConversationContext, ConversationFactValue } from '../domain/conversation-context';
import {
  createConversationContext,
  getAnswer,
  getFact,
  recordAnswer,
  setFactRecord,
} from '../domain/conversation-context';
import { processEmployeeMessage } from '../domain/conversation-core';
import { applyTransition } from '../domain/state-machine';
import type { IdentityPort } from '../ports/identity';
import type { IncidentPort } from '../ports/incident';
import type { KnowledgeItem, KnowledgePort } from '../ports/knowledge';
import type { AuditEvent, AuditLoggerPort, OperationalLoggerPort } from '../ports/logging';
import { createAuditEvent } from '../ports/logging';
import { containsSensitiveValue } from '../security/sensitive-values';
import { APP_VERSION, COMPONENT_CONVERSATION_ENGINE } from '../support/app-info';
import { makeId, nowIso } from '../support/ids';

/** Message roles for the chat shell. \u0060error\u0060 is a user-safe failure state. */
export type ChatMessageRole = 'elvie' | 'employee' | 'error';
export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly text: string;
}

export interface ConversationEngineDeps {
  readonly identity: IdentityPort;
  readonly knowledge: KnowledgePort;
  readonly incidents: IncidentPort;
  readonly operational: OperationalLoggerPort;
  readonly audit: AuditLoggerPort;
}

/**
 * Deterministic conversation engine.
 *
 * Build 02: the UNDERSTAND phase is powered by the deterministic Conversation
 * Core (normalisation, intent classification, fact extraction, conditional
 * missing-information calculation, typed decision). The engine only decides
 * WHEN to move between the authoritative Build 01 lifecycle states; it never
 * invents new transitions. Build 03 adds real knowledge ranking/resolution.
 */
export class ConversationEngine {
  private context: ConversationContext | null = null;
  private actorId = 'unknown';

  constructor(private readonly deps: ConversationEngineDeps) {}

  /**
   * Start a conversation. Authenticates first: when identity is not
   * configured, the engine fails closed and never creates a session.
   */
  async start(): Promise<readonly ChatMessage[]> {
    try {
      const employee = await this.deps.identity.getCurrentEmployee();
      this.actorId = employee.id;
      this.context = createConversationContext(makeId(), nowIso());
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
        return this.handleSolvedQuestion(text);
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

  // --- State handlers -----------------------------------------------------

  /**
   * UNDERSTAND: run the deterministic Conversation Core and follow its
   * decision. Insufficient understanding keeps the conversation in
   * UNDERSTAND (a clarifying/next question); sufficient understanding and
   * the security-sensitive route continue to KNOWLEDGE_SEARCH. No new
   * lifecycle transitions are invented.
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
      case 'sufficient_understanding':
        return this.searchKnowledge();
    }
  }

  /** KNOWLEDGE_SEARCH: consult the knowledge port (mock in Build 01/02). */
  private async searchKnowledge(): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    applyTransition(context, 'KNOWLEDGE_SEARCH');
    this.operational('info', 'searching knowledge', 'success');

    const results = await this.deps.knowledge.search({ text: String(getAnswer(context, 'initial_question') ?? '') });
    if (results.length > 0) {
      return [
        { role: 'elvie', text: 'Ik heb mogelijk bruikbare instructies gevonden:' },
        ...results.map(renderKnowledgeItem),
        { role: 'elvie', text: "Lost dit je probleem op? Antwoord 'ja' of 'nee'." },
      ];
    }
    applyTransition(context, 'INTAKE');
    return [
      { role: 'elvie', text: 'Ik heb hiervoor geen instructies gevonden.' },
      { role: 'elvie', text: 'Dan melden we een incident aan. Beschrijf kort wat er gebeurt.' },
    ];
  }

  private async handleSolvedQuestion(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const answer = text.trim().toLowerCase();
    recordAnswer(context, 'solved_question', answer);

    // Resolution decision (approved architectural decision): enter RESOLVE
    // first, then exit to DONE (solved) or INTAKE (not solved).
    applyTransition(context, 'RESOLVE');

    if (answer === 'ja' || answer === 'yes') {
      applyTransition(context, 'DONE');
      this.operational('info', 'knowledge resolved the issue', 'success');
      return [{ role: 'elvie', text: 'Fijn dat dit je verder hielp. Fijne dag!' }];
    }

    applyTransition(context, 'INTAKE');
    return [
      { role: 'elvie', text: 'Geen probleem, dan melden we een incident aan.' },
      { role: 'elvie', text: 'Beschrijf kort wat er gebeurt.' },
    ];
  }

  private async handleIntake(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    recordAnswer(context, 'symptom_description', text);
    setFactRecord(context, 'symptom', {
      value: text,
      kind: 'explicit',
      capturedAtTurn: context.currentTurn,
    });
    applyTransition(context, 'COMPLETE_CONTEXT');
    return [{ role: 'elvie', text: 'Dank je. Op welke locatie ben je op dit moment?' }];
  }

  private async handleCompleteContext(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    recordAnswer(context, 'location', text);
    setFactRecord(context, 'location', {
      value: text,
      kind: 'explicit',
      capturedAtTurn: context.currentTurn,
    });
    applyTransition(context, 'PREVIEW');
    return [
      {
        role: 'elvie',
        text:
          'Dit is een voorbeeld van je melding:\n\n' +
          'Samenvatting: ' +
          buildSummary(context) +
          '\nLocatie: ' +
          (getFact(context, 'location')?.value ?? 'onbekend') +
          "\n\nTyp 'versturen' om de melding definitief aan te maken.",
      },
    ];
  }

  private async handlePreview(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    const answer = text.trim().toLowerCase();
    if (answer !== 'versturen' && answer !== 'verzenden' && answer !== 'ja') {
      return [{ role: 'elvie', text: "Typ 'versturen' om de melding aan te maken, of geef aan wat je wilt aanpassen." }];
    }
    applyTransition(context, 'SUBMIT');
    this.operational('info', 'submitting incident', 'success');

    const draft = {
      summary: buildSummary(context),
      description: String(getAnswer(context, 'symptom_description') ?? ''),
      context: {
        locatie: getFact(context, 'location')?.value ?? '',
        startedAt: context.startedAt,
      },
    };
    try {
      const result = await this.deps.incidents.submit(draft);
      applyTransition(context, 'CONFIRM');
      this.auditSafe(
        createAuditEvent({
          eventType: 'incident_submission',
          actorId: this.actorId,
          action: 'submit_incident',
          targetType: 'incident',
          targetId: result.reference,
          outcome: 'success',
          correlationId: context.sessionId,
          component: COMPONENT_CONVERSATION_ENGINE,
          appVersion: APP_VERSION,
        }),
      );
      this.operational('info', 'incident submitted', 'success');
      return [{ role: 'elvie', text: 'Je melding is aangemaakt met referentie ' + result.reference + '. Fijne dag!' }];
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      this.auditSafe(
        createAuditEvent({
          eventType: 'incident_submission',
          actorId: this.actorId,
          action: 'submit_incident',
          targetType: 'incident',
          outcome: 'failed',
          correlationId: context.sessionId,
          component: COMPONENT_CONVERSATION_ENGINE,
          reason,
          appVersion: APP_VERSION,
        }),
      );
      this.operational('error', 'incident submission failed', 'failure', reason);
      return [
        {
          role: 'error',
          text: 'Het aanmaken van de melding is niet gelukt. Probeer het later opnieuw of neem contact op met de IT-servicebalie.',
        },
      ];
    }
  }

  // --- Helpers ------------------------------------------------------------

  private requireContext(): ConversationContext {
    if (this.context === null) {
      throw new Error('Conversation not started');
    }
    return this.context;
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

function renderKnowledgeItem(item: KnowledgeItem): ChatMessage {
  return { role: 'elvie', text: '- ' + item.title + ': ' + item.summary };
}

function buildSummary(context: ConversationContext): string {
  const fact = (key: string): ConversationFactValue | undefined => getAnswer(context, key);
  const initial = String(fact('initial_question') ?? getFact(context, 'symptom')?.value ?? '');
  return initial.length > 0 ? initial.slice(0, 80) : 'IT-vraag';
}
