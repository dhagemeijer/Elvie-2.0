import type { FactCategory, FactRecord } from './facts';
import type { ConversationIntent, IntentClassification } from './intent-classification';

/**
 * Conversation state names of the deterministic Elvie lifecycle.
 * Structural lifecycle defined in ARCHITECTURE.md / BUILD_01.md.
 * Build 03 adds NO state: the Build 01 state machine stays authoritative.
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
export type { ConversationIntent };

/**
 * Build 03 internal knowledge/resolution substatus (BUILD_03.md par. 9).
 * This is NOT a lifecycle state: it only steers input interpretation and
 * allowed actions within the existing KNOWLEDGE_SEARCH state.
 */
export type KnowledgePhase = 'searching' | 'awaiting_feedback' | 'clarifying' | 'dependency_error' | 'exhausted';

/** Internal generic intake type (BUILD_03.md par. 12). */
export type IntakeType = 'incident' | 'request' | 'security';

/**
 * Internal submission status of the logical ticket submission
 * (BUILD_03.md par. 13). Also not a lifecycle state.
 */
export type SubmissionStatus = 'idle' | 'confirmed' | 'submitted' | 'failed' | 'inconclusive';

/** Bookkeeping of the logical submission attempt. */
export interface SubmissionState {
  /** 1-based attempt counter; a new attempt gets a new submission key. */
  attempt: number;
  /** SubmissionKey of the current/latest attempt, once confirmed. */
  key?: string;
  status: SubmissionStatus;
  /** Reference received for a demonstrably submitted attempt. */
  reference?: string;
}

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
 *
 * Build 03 additions (all internal, never new lifecycle states):
 * - knowledgePhase, offered-article bookkeeping and unclear-feedback
 *   counter for the guided resolution flow;
 * - intakeType for the generic intake (incident/request/security);
 * - pendingIntakeCategory for never-knowingly-ask-twice bookkeeping;
 * - submission state for the idempotent ticket submission protocol.
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
  intent?: ConversationIntent;
  /** Explainable classification record (value, qualitative confidence, evidence). */
  intentClassification?: IntentClassification;
  /**
   * Active structured facts per category. Unknown categories are absent;
   * no category is ever filled with an invented default.
   */
  facts: Partial<Record<FactCategory, FactRecord>>;
  /** Answers already supplied, keyed by logical question name. */
  readonly answers: Readonly<Record<string, ConversationFactValue>>;
  /** Build 03: internal knowledge/resolution substatus. */
  knowledgePhase?: KnowledgePhase;
  /** Build 03: distinct article ids offered in the current resolution series. */
  knowledgeOfferedArticleIds: string[];
  /** Build 03: article currently awaiting feedback (if any). */
  currentKnowledgeArticleId?: string;
  /** Build 03: consecutive unclear feedback counter (anti-loop bookkeeping). */
  unclearFeedbackCount: number;
  /** Build 03: internal generic intake type. */
  intakeType?: IntakeType;
  /** Build 03: category of the currently pending intake question (if any). */
  pendingIntakeCategory?: FactCategory;
  /** Build 03: logical submission state of the ticket. */
  submission: SubmissionState;
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
    knowledgePhase: undefined,
    knowledgeOfferedArticleIds: [],
    currentKnowledgeArticleId: undefined,
    unclearFeedbackCount: 0,
    intakeType: undefined,
    pendingIntakeCategory: undefined,
    submission: { attempt: 0, status: 'idle' },
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
 * or derived) or a recorded answer.
 * Used by the missing-information engine
 * to enforce NEVER KNOWINGLY ASK TWICE.
 */
export function hasReliableFact(context: ConversationContext, category: FactCategory): boolean {
  return getFact(context, category) !== undefined || hasAnswer(context, category);
}
