import { describe, expect, it } from 'vitest';
import {
  createConversationContext,
  getAnswer,
  hasAnswer,
  recordAnswer,
} from '../src/domain/conversation-context';

describe('ConversationContext', () => {
  it('can be created with unknown optional facts', () => {
    const context = createConversationContext('session-1', '2026-10-03T12:00:00.000Z');
    expect(context.sessionId).toBe('session-1');
    expect(context.currentState).toBe('START');
    expect(context.intent).toBeUndefined();
    expect(context.symptom).toBeUndefined();
    expect(context.location).toBeUndefined();
    expect(context.confidence).toBeUndefined();
    expect(context.answers).toEqual({});
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
