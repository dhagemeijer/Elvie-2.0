import { describe, expect, it } from 'vitest';
import type { ConversationStateName } from '../src/domain/conversation-context';
import {
  InvalidTransitionError,
  applyTransition,
  assertTransition,
  canTransition,
  STATE_TRANSITIONS,
} from '../src/domain/state-machine';

describe('conversation state machine', () => {
  it('supports the full structural lifecycle (resolve path)', () => {
    const holder = { currentState: 'START' as ConversationStateName };
    applyTransition(holder, 'UNDERSTAND');
    applyTransition(holder, 'KNOWLEDGE_SEARCH');
    applyTransition(holder, 'RESOLVE');
    applyTransition(holder, 'DONE');
    expect(holder.currentState).toBe('DONE');
  });

  it('supports the resolve-to-intake path when the resolution did not solve the issue', () => {
    const holder = { currentState: 'START' as ConversationStateName };
    applyTransition(holder, 'UNDERSTAND');
    applyTransition(holder, 'KNOWLEDGE_SEARCH');
    applyTransition(holder, 'RESOLVE');
    applyTransition(holder, 'INTAKE');
    applyTransition(holder, 'COMPLETE_CONTEXT');
    applyTransition(holder, 'PREVIEW');
    applyTransition(holder, 'SUBMIT');
    applyTransition(holder, 'CONFIRM');
    expect(holder.currentState).toBe('CONFIRM');
  });

  it('allows both RESOLVE exits (DONE and INTAKE) per the approved resolution decision', () => {
    expect(canTransition('RESOLVE', 'DONE')).toBe(true);
    expect(canTransition('RESOLVE', 'INTAKE')).toBe(true);
    expect(STATE_TRANSITIONS.RESOLVE).toEqual(['DONE', 'INTAKE']);
  });

  it('supports the full structural lifecycle (direct intake path)', () => {
    const holder = { currentState: 'START' as ConversationStateName };
    applyTransition(holder, 'UNDERSTAND');
    applyTransition(holder, 'KNOWLEDGE_SEARCH');
    applyTransition(holder, 'INTAKE');
    applyTransition(holder, 'COMPLETE_CONTEXT');
    applyTransition(holder, 'PREVIEW');
    applyTransition(holder, 'SUBMIT');
    applyTransition(holder, 'CONFIRM');
    expect(holder.currentState).toBe('CONFIRM');
  });

  it.each([
    ['START', 'DONE'],
    ['START', 'INTAKE'],
    ['UNDERSTAND', 'PREVIEW'],
    ['KNOWLEDGE_SEARCH', 'SUBMIT'],
    ['KNOWLEDGE_SEARCH', 'START'],
    ['RESOLVE', 'CONFIRM'],
    ['RESOLVE', 'PREVIEW'],
    ['RESOLVE', 'START'],
    ['INTAKE', 'PREVIEW'],
    ['DONE', 'START'],
    ['DONE', 'INTAKE'],
    ['CONFIRM', 'START'],
    ['CONFIRM', 'INTAKE'],
  ] as const)('rejects invalid transition %s -> %s deterministically', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it('rejects invalid transitions without mutating the current state', () => {
    const holder = { currentState: 'PREVIEW' as ConversationStateName };
    expect(() => applyTransition(holder, 'CONFIRM')).toThrow(InvalidTransitionError);
    expect(holder.currentState).toBe('PREVIEW');
  });

  it('treats DONE and CONFIRM as terminal states', () => {
    expect(STATE_TRANSITIONS.DONE).toEqual([]);
    expect(STATE_TRANSITIONS.CONFIRM).toEqual([]);
  });
});
