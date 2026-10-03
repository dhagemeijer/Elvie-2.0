import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../src/domain/conversation-context';
import { createConversationContext, recordAnswer, setFactRecord } from '../src/domain/conversation-context';
import type { FactCategory } from '../src/domain/facts';
import type { ConversationIntent, IntentClassification } from '../src/domain/intent-classification';
import {
  FACT_CATEGORY_PRIORITY,
  FICTIONAL_REQUIREMENT_RULES,
  calculateMissingFacts,
  type RequirementRule,
} from '../src/domain/requirements';

function contextWithIntent(
  value: ConversationIntent,
  confidence: IntentClassification['confidence'] = 'high',
): ConversationContext {
  const context = createConversationContext('session-test', '2026-10-03T12:00:00.000Z');
  context.intent = value;
  context.intentClassification = { value, confidence, evidence: [] };
  return context;
}

function addExplicitFact(context: ConversationContext, category: FactCategory, value: string): void {
  setFactRecord(context, category, { value, kind: 'explicit', capturedAtTurn: 1 });
}

function addDerivedFact(
  context: ConversationContext,
  category: FactCategory,
  value: string,
  sourceRuleId: string,
): void {
  setFactRecord(context, category, { value, kind: 'derived', sourceRuleId, capturedAtTurn: 1 });
}

describe('conditional requirement model (never a static per-intent list)', () => {
  it('does not require an application for a printer incident', () => {
    const context = contextWithIntent('incident');
    addExplicitFact(context, 'device', 'printer');
    addDerivedFact(context, 'symptom', 'not_working', 'symptom_not_working');
    const calculation = calculateMissingFacts(context, FICTIONAL_REQUIREMENT_RULES);
    expect(calculation.required).toContain('symptom');
    expect(calculation.required).not.toContain('serviceOrApplication');
    expect(calculation.missing).toEqual([]);
  });

  it('does not automatically require a device for an account problem', () => {
    const context = contextWithIntent('incident');
    addExplicitFact(context, 'serviceOrApplication', 'Account');
    addDerivedFact(context, 'symptom', 'unavailable', 'symptom_login_block');
    const calculation = calculateMissingFacts(context, FICTIONAL_REQUIREMENT_RULES);
    expect(calculation.required).toContain('symptom');
    expect(calculation.required).toContain('serviceOrApplication');
    expect(calculation.required).not.toContain('device');
    expect(calculation.missing).toEqual([]);
  });

  it('requires a device for an application problem where relevant (Outlook)', () => {
    const context = contextWithIntent('incident');
    addExplicitFact(context, 'serviceOrApplication', 'Outlook');
    addDerivedFact(context, 'symptom', 'not_working', 'symptom_not_working');
    const calculation = calculateMissingFacts(context, FICTIONAL_REQUIREMENT_RULES);
    expect(calculation.required).toContain('symptom');
    expect(calculation.required).toContain('serviceOrApplication');
    expect(calculation.missing).toEqual(['device']);
  });

  it('requires the requested resource for a request', () => {
    const empty = contextWithIntent('request');
    const without = calculateMissingFacts(empty, FICTIONAL_REQUIREMENT_RULES);
    expect(without.required).toContain('requestedResource');
    expect(without.missing).toEqual(['requestedResource']);

    const filled = contextWithIntent('request');
    addExplicitFact(filled, 'requestedResource', 'Mailbox');
    const withResource = calculateMissingFacts(filled, FICTIONAL_REQUIREMENT_RULES);
    expect(withResource.missing).toEqual([]);
  });

  it('uses the applicable security clarification requirement for a phishing case', () => {
    const without = contextWithIntent('phishing');
    expect(calculateMissingFacts(without, FICTIONAL_REQUIREMENT_RULES).missing).toEqual(['securityIndicators']);

    const withIndicators = contextWithIntent('phishing');
    addDerivedFact(withIndicators, 'securityIndicators', 'suspicious_link_clicked', 'security_indicator_aggregate');
    const calculation = calculateMissingFacts(withIndicators, FICTIONAL_REQUIREMENT_RULES);
    expect(calculation.required).toEqual(['securityIndicators']);
    expect(calculation.missing).toEqual([]);
  });

  it('never knowingly asks twice: a recorded answer satisfies a required category', () => {
    const context = contextWithIntent('incident');
    addExplicitFact(context, 'serviceOrApplication', 'Outlook');
    addDerivedFact(context, 'symptom', 'not_working', 'symptom_not_working');
    recordAnswer(context, 'device', 'laptop');
    const calculation = calculateMissingFacts(context, FICTIONAL_REQUIREMENT_RULES);
    expect(calculation.required).toContain('device');
    expect(calculation.missing).toEqual([]);
  });

  it('is rule-driven: a custom rule set produces different requirements deterministically', () => {
    const customRules: readonly RequirementRule[] = [
      { ruleId: 'test_req_location', when: { intent: 'incident' }, require: ['location'] },
    ];
    const context = contextWithIntent('incident');
    addDerivedFact(context, 'symptom', 'not_working', 'symptom_not_working');
    const first = calculateMissingFacts(context, customRules);
    const second = calculateMissingFacts(context, customRules);
    expect(first.required).toEqual(['location']);
    expect(first.missing).toEqual(['location']);
    expect(second).toEqual(first);
  });

  it('orders required categories by the fixed documented priority (symptom first)', () => {
    expect(FACT_CATEGORY_PRIORITY[0]).toBe('symptom');
    expect(new Set(FACT_CATEGORY_PRIORITY).size).toBe(FACT_CATEGORY_PRIORITY.length);
    expect(FACT_CATEGORY_PRIORITY).toHaveLength(11);
  });
});
