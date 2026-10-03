/**
 * Conversation state names of the deterministic Elvie lifecycle.
 * Structural lifecycle defined in ARCHITECTURE.md / BUILD_01.md.
 */
export type ConversationStateName =
  | 'START'
  | 'UNDERSTAND'
  | 'KNOWLEDGE_SEARCH'
  | 'RESOLVE'
  | 'DONE'
  | 'INTAKE'
  | 'COMPLETE_CONTEXT'
  | 'PREVIEW'
  | 'SUBMIT'
  | 'CONFIRM';

/** Facts are intentionally TOPdesk-independent. */
export type ConversationFactValue = string | number | boolean | readonly string[];

/** Initial intent classification placeholder; real rules arrive in Build 02. */
export type ConversationIntent = 'incident' | 'request' | 'phishing' | 'unknown';

/**
 * Central, typed conversation context. Every field except identity of the
 * session itself is optional: unknown facts stay unknown rather than being
 * filled with invented defaults.
 */
export interface ConversationContext {
  readonly sessionId: string;
  readonly startedAt: string;
  currentState: ConversationStateName;
  intent?: ConversationIntent;
  serviceOrApplication?: string;
  device?: string;
  symptom?: string;
  impact?: string;
  urgency?: string;
  location?: string;
  affectedUsers?: string;
  attemptedSolutions?: string;
  securityIndicators?: string;
  confidence?: number;
  /** Answers already supplied, keyed by logical question name. */
  readonly answers: Readonly<Record<string, ConversationFactValue>>;
}

export function createConversationContext(sessionId: string, startedAt: string): ConversationContext {
  return {
    sessionId,
    startedAt,
    currentState: 'START',
    intent: undefined,
    answers: {},
  };
}

/**
 * Record an answer so it is retained and never needs to be asked again.
 */
export function recordAnswer(
  context: ConversationContext,
  questionKey: string,
  value: ConversationFactValue,
): ConversationContext {
  const answers = context.answers as Record<string, ConversationFactValue>;
  answers[questionKey] = value;
  return context;
}

/** Returns true when the answer to the given question is already known. */
export function hasAnswer(context: ConversationContext, questionKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(context.answers, questionKey);
}

/** Read a previously supplied answer, if any. */
export function getAnswer(context: ConversationContext, questionKey: string): ConversationFactValue | undefined {
  return context.answers[questionKey];
}
