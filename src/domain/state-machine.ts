import type { ConversationStateName } from './conversation-context';

/**
 * Allowed state transitions, exactly as specified by the structural lifecycle
 * in ARCHITECTURE.md and BUILD_01.md:
 *
 * START -> UNDERSTAND -> KNOWLEDGE_SEARCH -> RESOLVE -> DONE
 *                                  \-> INTAKE -> COMPLETE_CONTEXT -> PREVIEW -> SUBMIT -> CONFIRM
 */
export const STATE_TRANSITIONS: Readonly<Record<ConversationStateName, readonly ConversationStateName[]>> = {
  START: ['UNDERSTAND'],
  UNDERSTAND: ['KNOWLEDGE_SEARCH'],
  KNOWLEDGE_SEARCH: ['RESOLVE', 'INTAKE'],
  RESOLVE: ['DONE'],
  DONE: [],
  INTAKE: ['COMPLETE_CONTEXT'],
  COMPLETE_CONTEXT: ['PREVIEW'],
  PREVIEW: ['SUBMIT'],
  SUBMIT: ['CONFIRM'],
  CONFIRM: [],
};

/** Thrown when a transition is attempted that the lifecycle does not allow. */
export class InvalidTransitionError extends Error {
  public readonly from: ConversationStateName;
  public readonly to: ConversationStateName;

  constructor(from: ConversationStateName, to: ConversationStateName) {
    super(`Invalid conversation state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Deterministically check whether a transition is allowed. */
export function canTransition(from: ConversationStateName, to: ConversationStateName): boolean {
  const allowed = STATE_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Assert a transition. Invalid transitions are rejected deterministically
 * by throwing InvalidTransitionError; the current state is never mutated.
 */
export function assertTransition(from: ConversationStateName, to: ConversationStateName): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Apply a transition to a context holder (mutates currentState). */
export function applyTransition<S extends { currentState: ConversationStateName }>(
  holder: S,
  to: ConversationStateName,
): S {
  assertTransition(holder.currentState, to);
  holder.currentState = to;
  return holder;
}
