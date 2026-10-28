import { describe, expect, it } from 'vitest';
import { classifyAnswerOutcome, recordAnswerOutcome } from '../src/domain/answer-outcome';
import {
  createConversationContext,
  hasReliableFact,
  setFactRecord,
} from '../src/domain/conversation-context';
import { UNKNOWN_LABEL, validateIntake } from '../src/domain/intake-policy';
import { materialStateProjection, nextMaterialRevision } from '../src/domain/material-revision';
import { calculateMissingFactsForCategory, FICTIONAL_REQUIREMENT_RULES } from '../src/domain/requirements';

describe('BUILD 04B — typed answer classification (§6.1, I-01/F-04)', () => {
  it('classifies concrete, explicit unknown and invalid answers deterministically', () => {
    expect(classifyAnswerOutcome('Mijn laptop', 1)).toMatchObject({ kind: 'concrete', value: 'Mijn laptop' });
    expect(classifyAnswerOutcome('weet ik niet', 1)).toMatchObject({ kind: 'explicit_unknown' });
    expect(classifyAnswerOutcome('  Weet niet ', 1)).toMatchObject({ kind: 'explicit_unknown' });
    expect(classifyAnswerOutcome('geen idee', 1)).toMatchObject({ kind: 'explicit_unknown' });
    expect(classifyAnswerOutcome('onbekend', 1)).toMatchObject({ kind: 'explicit_unknown' });
    expect(classifyAnswerOutcome('', 1)).toMatchObject({ kind: 'invalid', reasonCode: 'empty_answer' });
    expect(classifyAnswerOutcome('ja', 1)).toMatchObject({ kind: 'invalid', reasonCode: 'unusable_answer' });
    expect(classifyAnswerOutcome('bevestigen', 1)).toMatchObject({ kind: 'invalid', reasonCode: 'unusable_answer' });
    expect(classifyAnswerOutcome('h', 1)).toMatchObject({ kind: 'invalid', reasonCode: 'unusable_answer' });
  });
});

describe('BUILD 04B — intake validation (§6.2/§6.3, I-02..I-08)', () => {
  const base = () => {
    const context = createConversationContext('s1', '2026-01-01T00:00:00Z');
    context.intent = 'incident';
    context.intakeType = 'incident';
    setFactRecord(context, 'symptom', {
      value: 'print niet',
      kind: 'derived',
      confidence: 'high',
      sourceRuleId: 'symptom_print_failure',
      evidence: ['print niet'],
      capturedAtTurn: 1,
    });
    return context;
  };

  it('required_concrete stays incomplete at an accepted unknown (I-04/F-05)', () => {
    const context = createConversationContext('s5', '2026-01-01T00:00:00Z');
    context.intent = 'incident';
    context.intakeType = 'incident';
    recordAnswerOutcome(context, 'symptom', { kind: 'explicit_unknown', capturedAtTurn: 1 });
    const result = validateIntake(context, 'incident', 'workplace');
    expect(result.outcome).toBe('needs_information');
    expect(result.fields.find((f) => f.field === 'symptom')).toMatchObject({
      status: 'explicit_unknown',
      policy: 'required_concrete',
    });
    // A concrete typed outcome never comes from an explicit unknown.
    expect(hasReliableFact(context, 'symptom')).toBe(false);
  });

  it('required_answer completes at an accepted explicit unknown and is never re-asked (I-03)', () => {
    const context = base();
    recordAnswerOutcome(context, 'device', { kind: 'explicit_unknown', capturedAtTurn: 2 });
    const result = validateIntake(context, 'incident', 'workplace');
    expect(result.fields.find((f) => f.field === 'device')).toMatchObject({
      status: 'explicit_unknown',
      policy: 'required_answer',
    });
    expect(result.unknownFields).toContain('device');
    expect(result.outcome).toBe('needs_information'); // serviceOrApplication still missing
  });

  it('a validated concrete outcome completes a required field (I-01)', () => {
    const context = base();
    recordAnswerOutcome(context, 'device', { kind: 'concrete', value: 'laptop', capturedAtTurn: 2 });
    expect(hasReliableFact(context, 'device')).toBe(true);
    const result = validateIntake(context, 'incident', 'workplace');
    expect(result.fields.find((f) => f.field === 'device')).toMatchObject({ status: 'concrete' });
  });

  it('a contradiction between a fact and an accepted unknown requires clarification (I-08)', () => {
    const context = base();
    setFactRecord(context, 'device', {
      value: 'laptop',
      kind: 'derived',
      confidence: 'high',
      sourceRuleId: 'device_laptop',
      evidence: ['laptop'],
      capturedAtTurn: 1,
    });
    recordAnswerOutcome(context, 'device', { kind: 'explicit_unknown', capturedAtTurn: 2 });
    const result = validateIntake(context, 'incident', 'workplace');
    expect(result.outcome).toBe('clarification_required');
    expect(result.reasonCode).toBe('contradictory_essential_facts');
  });

  it('a route change recomputes the requirements (I-07/P-05)', () => {
    const context = createConversationContext('s2', '2026-01-01T00:00:00Z');
    context.intent = 'incident';
    const withRoute = calculateMissingFactsForCategory(context, FICTIONAL_REQUIREMENT_RULES, 'incident', 'workplace');
    const withoutRoute = calculateMissingFactsForCategory(context, FICTIONAL_REQUIREMENT_RULES, 'incident', 'application');
    expect(withRoute.required).toContain('device');
    expect(withoutRoute.required).not.toContain('device');
  });

  it('security cases always take the safe security route and are never blocked (F-06/I-10)', () => {
    const context = createConversationContext('s3', '2026-01-01T00:00:00Z');
    context.intakeType = 'security';
    const result = validateIntake(context, 'security', 'security');
    expect(result.outcome).toBe('security_route_required');
    expect(result.reasonCode).toBe('security_safe_handling');
  });

  it('is deterministic: identical inputs produce identical results (I-11)', () => {
    const context = base();
    const a = validateIntake(context, 'incident', 'workplace');
    const b = validateIntake(context, 'incident', 'workplace');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(UNKNOWN_LABEL).toBe('niet bekend (volgens medewerker)');
  });
});

describe('BUILD 04B — material revision over typed answers (§15.2/§15.3)', () => {
  it('a change OUTSIDE the original five routing fields bumps the revision exactly once', () => {
    const context = createConversationContext('s4', '2026-01-01T00:00:00Z');
    context.intent = 'incident';
    const before = materialStateProjection(context, 'unknown~none');
    recordAnswerOutcome(context, 'device', { kind: 'explicit_unknown', capturedAtTurn: 1 });
    const afterUnknown = materialStateProjection(context, 'unknown~none');
    expect(nextMaterialRevision(before, afterUnknown, 3)).toBe(4);
    // Administratively refreshing the same outcome (new capturedAtTurn,
    // same material content) never bumps the revision.
    recordAnswerOutcome(context, 'device', { kind: 'explicit_unknown', capturedAtTurn: 9 });
    const refreshed = materialStateProjection(context, 'unknown~none');
    expect(nextMaterialRevision(afterUnknown, refreshed, 4)).toBe(4);
    // A validated concrete value is again a material change.
    recordAnswerOutcome(context, 'device', { kind: 'concrete', value: 'laptop', capturedAtTurn: 10 });
    const afterConcrete = materialStateProjection(context, 'unknown~none');
    expect(nextMaterialRevision(refreshed, afterConcrete, 4)).toBe(5);
  });
});
