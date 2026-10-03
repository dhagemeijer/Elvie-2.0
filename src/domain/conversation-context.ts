import type { FactCategory, FactRecord } from './facts';
import type { IntentClassification } from './intent-classification';

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

// Re-exported for existing import sites; defined with the classifier.
export type { ConversationIntent } from './intent-classification';

/**
 * Central, typed conversation context. Every field except identity of the
 * session itself is optional: unknown facts stay unknown rather than being
 * filled with invented defaults.
 *
 * Build 02 (approved migration, BUILD_02.md par. 8): the former scalar
 * confidence?: number is REMOVED. Confidence now belongs to individual
 * derived conclusions (IntentClassification and derived FactRecords carry a
 * qualitative high | medium | low confidence). Facts are stored as
 * structured FactRecords per category; the raw scalar fact fields and the
 * full-confidence field are gone. No persisted production conversation
 * model exists yet, so no compatibility field is kept.
 */
export interface ConversationContext {
  readonly sessionId: string;
  readonly startedAt: string;
  currentState: ConversationStateName;
  /**
   * Logical conversation turn ordering (incremented once per accepted
   * employee message). NOT wall-clock time: determinism never depends on
   * the clock unless time is an explicit input.
   */
  currentTurn: number;
  /** Latest effective intent (kept in sync with intentClassification). */
  intent?: import('./intent-classification').ConversationIntent;
  /** Explainable classification record (value, qualitative confidence, evidence). */
  intentClassification?: IntentClassification;
  /**
   * Active structured facts per category. Unknown categories are absent;
   * no category is ever filled with an invented default.
   */
  facts: Partial<Record<FactCategory, FactRecord>>;
  /** Answers already supplied, keyed by logical question name. */
  readonly answers: Readonly<Record<string, ConversationFactValue>>;
}

export function createConversationContext(sessionId: string, startedAt: string): ConversationContext {
  return {
    sessionId,
    startedAt,
    currentState: 'START',
    currentTurn: 0,
    intent: undefined,
    facts: {},
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

/** Read the active fact record for a category, if any. */
export function getFact(context: ConversationContext, category: FactCategory): FactRecord | undefined {
  return context.facts[category];
}

/** Set the active fact record for a category (context-merge precedence logic decides). */
export function setFactRecord(context: ConversationContext, category: FactCategory, record: FactRecord): ConversationContext {
  context.facts[category] = record;
  return context;
}

/**
 * A category is reliably known when it has an active fact record (explicit
 * or derived) or a recorded answer. Used by the missing-information engine
 * to enforce NEVER KNOWINGLY ASK TWICE.
 */
export function hasReliableFact(context: ConversationContext, category: FactCategory): boolean {
  return getFact(context, category) !== undefined || hasAnswer(context, category);
}
