import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../src/domain/conversation-context';
import { createConversationContext, recordAnswer, setFactRecord } from '../src/domain/conversation-context';
import { materialStateProjection, nextMaterialRevision } from '../src/domain/material-revision';

describe('material state projection and revision (BUILD 04A §15.3 final remediation)', () => {
  function newContext(): ConversationContext {
    const context = createConversationContext('session-1', '2026-01-01T00:00:00.000Z');
    context.currentTurn = 1;
    context.intent = 'incident';
    context.intentClassification = { value: 'incident', confidence: 'high', evidence: ['doet het niet'] };
    return context;
  }

  it('recognizes a material change OUTSIDE the five routing fields (validated answer)', () => {
    const context = newContext();
    const before = materialStateProjection(context, 'r');
    recordAnswer(context, 'location', 'kantoor Amsterdam');
    const after = materialStateProjection(context, 'r');
    expect(after).not.toBe(before);
    expect(nextMaterialRevision(before, after, 3)).toBe(4);
  });

  it('recognizes a material change OUTSIDE the five routing fields (security/ticket state)', () => {
    const context = newContext();
    const before = materialStateProjection(context, 'r');
    context.intakeType = 'security';
    expect(materialStateProjection(context, 'r')).not.toBe(before);
  });

  it('recognizes a material change in the requirements/validation outcome', () => {
    const context = newContext();
    const before = materialStateProjection(context, 'r');
    setFactRecord(context, 'symptom', {
      value: 'doet het niet',
      kind: 'derived',
      confidence: 'high',
      sourceRuleId: 'symptom_not_working',
      evidence: ['doet het niet'],
      capturedAtTurn: 1,
    });
    // The incident now has a reliable symptom: the still-missing outcome
    // changes, which is material for the revision.
    expect(materialStateProjection(context, 'r')).not.toBe(before);
  });

  it('keeps the revision for identical material input without a material change (administrative refresh)', () => {
    const context = newContext();
    setFactRecord(context, 'device', { value: 'laptop', kind: 'explicit', capturedAtTurn: 1 });
    const before = materialStateProjection(context, 'r');
    // The same fact re-captured in a later turn: only the administrative
    // capturedAtTurn/currentTurn ordering changes, never the material state.
    setFactRecord(context, 'device', { value: 'laptop', kind: 'explicit', capturedAtTurn: 2 });
    context.currentTurn = 2;
    const after = materialStateProjection(context, 'r');
    expect(after).toBe(before);
    expect(nextMaterialRevision(before, after, 3)).toBe(3);
  });

  it('is canonical and deterministic: identical material state gives an identical projection', () => {
    const a = newContext();
    const b = newContext();
    setFactRecord(a, 'device', { value: 'laptop', kind: 'explicit', capturedAtTurn: 1 });
    setFactRecord(b, 'device', { value: 'laptop', kind: 'explicit', capturedAtTurn: 7 });
    recordAnswer(a, 'startTime', 'sinds vanochtend');
    recordAnswer(b, 'startTime', 'sinds vanochtend');
    expect(materialStateProjection(a, 'r')).toBe(materialStateProjection(b, 'r'));
  });

  it('excludes the turn-1 initial_question retention echo from the material state', () => {
    const a = newContext();
    const b = newContext();
    recordAnswer(b, 'initial_question', 'hoi elvie');
    // Traceability bookkeeping of the opening message is administrative:
    // the material projection stays identical.
    expect(materialStateProjection(b, 'r')).toBe(materialStateProjection(a, 'r'));
  });

  it('bumps the revision exactly once for a materially changed turn', () => {
    const before = materialStateProjection(newContext(), 'r');
    const context = newContext();
    setFactRecord(context, 'device', { value: 'laptop', kind: 'explicit', capturedAtTurn: 1 });
    recordAnswer(context, 'location', 'kantoor Amsterdam');
    // Multiple material changes in ONE accepted turn: exactly one bump.
    const after = materialStateProjection(context, 'r');
    expect(nextMaterialRevision(before, after, 5)).toBe(6);
  });
});
