import type { ConversationContext, ConversationFactValue } from '../domain/conversation-context';
import { createConversationContext, getAnswer, recordAnswer } from '../domain/conversation-context';
import { applyTransition } from '../domain/state-machine';
import type { IdentityPort } from '../ports/identity';
import type { IncidentPort } from '../ports/incident';
import type { KnowledgeItem, KnowledgePort } from '../ports/knowledge';
import type { AuditEvent, AuditLoggerPort, OperationalLoggerPort } from '../ports/logging';
import { createAuditEvent } from '../ports/logging';
import { containsSensitiveValue } from '../security/sensitive-values';
import { APP_VERSION, COMPONENT_CONVERSATION_ENGINE } from '../support/app-info';
import { makeId, nowIso } from '../support/ids';

/** Message roles for the chat shell. `error` is a user-safe failure state. */
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
 * Deterministic conversation skeleton for Build 01.
 *
 * Build 01 establishes the typed lifecycle and controlled transitions; the
 * final intelligence/rules per state (intent detection, entity extraction,
 * ranking) arrive in Builds 02-03 per ROADMAP.md. This engine walks the
 * structural lifecycle deterministically through the mock ports.
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
          text: `Hallo ${employee.displayName}! Ik ben Elvie, de digitale assistent van de IT-servicebalie.`,
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

    switch (context.currentState) {
      case 'START':
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

  private async handleUnderstand(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    recordAnswer(context, 'initial_question', text);
    context.intent = 'unknown';
    applyTransition(context, 'UNDERSTAND');
    applyTransition(context, 'KNOWLEDGE_SEARCH');
    this.operational('info', 'searching knowledge', 'success');

    const results = await this.deps.knowledge.search({ text });
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
    context.symptom = text;
    applyTransition(context, 'COMPLETE_CONTEXT');
    return [{ role: 'elvie', text: 'Dank je. Op welke locatie ben je op dit moment?' }];
  }

  private async handleCompleteContext(text: string): Promise<readonly ChatMessage[]> {
    const context = this.requireContext();
    recordAnswer(context, 'location', text);
    context.location = text;
    applyTransition(context, 'PREVIEW');
    return [
      {
        role: 'elvie',
        text: `Dit is een voorbeeld van je melding:\n\nSamenvatting: ${buildSummary(context)}\nLocatie: ${context.location ?? 'onbekend'}\n\nTyp 'versturen' om de melding definitief aan te maken.`,
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
        locatie: context.location ?? '',
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
      return [{ role: 'elvie', text: `Je melding is aangemaakt met referentie ${result.reference}. Fijne dag!` }];
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
  return { role: 'elvie', text: `- ${item.title}: ${item.summary}` };
}

function buildSummary(context: ConversationContext): string {
  const fact = (key: string): ConversationFactValue | undefined => getAnswer(context, key);
  const initial = String(fact('initial_question') ?? context.symptom ?? '');
  return initial.length > 0 ? initial.slice(0, 80) : 'IT-vraag';
}
