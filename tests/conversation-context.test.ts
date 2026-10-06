import { describe, expect, it } from 'vitest';
import type { FactRecord } from '../src/domain/facts';
import {
  createConversationContext,
  getAnswer,
  getFact,
  hasAnswer,
  hasReliableFact,
  recordAnswer,
  setFactRecord,
} from '../src/domain/conversation-context';

describe('ConversationContext', () => {
  it('can be created with unknown optional facts and no conversation-level confidence', () => {
    const context = createConversationContext('session-1', '2026-10-03T12:00:00.000Z');
    expect(context.sessionId).toBe('session-1');
    expect(context.currentState).toBe('START');
    expect(context.currentTurn).toBe(0);
    expect(context.intent).toBeUndefined();
    expect(context.intentClassification).toBeUndefined();
    expect(context.facts).toEqual({});
    expect(context.answers).toEqual({});
  });

  it('retains structured fact records per category (Build 02 model)', () => {
    const context = createConversationContext('session-1', '2026-10-03T12:00:00.000Z');
    const explicit: FactRecord = { value: 'Outlook', kind: 'explicit', evidence: ['outlook'], capturedAtTurn: 1 };
    setFactRecord(context, 'serviceOrApplication', explicit);
    expect(getFact(context, 'serviceOrApplication')).toEqual(explicit);
    expect(hasReliableFact(context, 'serviceOrApplication')).toBe(true);
    expect(hasReliableFact(context, 'device')).toBe(false);

    const derived: FactRecord = {
      value: 'not_working',
      kind: 'derived',
      confidence: 'medium',
      sourceRuleId: 'symptom_not_working',
      evidence: ['doet het niet'],
      capturedAtTurn: 2,
    };
    setFactRecord(context, 'symptom', derived);
    expect(getFact(context, 'symptom')?.capturedAtTurn).toBe(2);
    expect(getFact(context, 'symptom')?.kind).toBe('derived');
  });

  it('retains recorded answers without inventing defaults', () => {
    const context = createConversationContext('session-1', '2026-10-03T12:00:00.000Z');
    recordAnswer(context, 'location', 'Hoofdgebouw');
    expect(hasAnswer(context, 'location')).toBe(true);
    expect(getAnswer(context, 'location')).toBe('Hoofdgebouw');
    expect(hasAnswer(context, 'device')).toBe(false);
  });

  it('can retain repeated context facts without forcing a repeated question', () => {
    const context = createConversationContext('session-1', '2026-10-03T12:00:00.000Z');
    recordAnswer(context, 'symptom_description', 'printer doet niets');
    // Same key supplied again: retained, never re-asked.
    recordAnswer(context, 'symptom_description', 'printer doet nog steeds niets');
    expect(hasAnswer(context, 'symptom_description')).toBe(true);
    expect(getAnswer(context, 'symptom_description')).toBe('printer doet nog steeds niets');
  });
});
