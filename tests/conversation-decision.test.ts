import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../src/domain/conversation-context';
import { createConversationContext, setFactRecord } from '../src/domain/conversation-context';
import type { Ambiguity } from '../src/domain/fact-extraction';
import { FACT_QUESTIONS, decide } from '../src/domain/conversation-decision';
import type { MissingInformationCalculation } from '../src/domain/requirements';

function contextWithIntent(value: 'incident' | 'request' | 'phishing' | 'unknown'): ConversationContext {
  const context = createConversationContext('session-test', '2026-10-03T12:00:00.000Z');
  context.intent = value;
  context.intentClassification = { value, confidence: 'high', evidence: [] };
  return context;
}

function calculation(required: string[], missing: string[]): MissingInformationCalculation {
  return { required, missing } as MissingInformationCalculation;
}

describe('typed ConversationDecision (not a second state machine)', () => {
  it('returns unknown_understanding for an unknown intent', () => {
    const decision = decide(createConversationContext('session-test', '2026-10-03T12:00:00.000Z'), calculation([], []), []);
    expect(decision.kind).toBe('unknown_understanding');
    if (decision.kind === 'unknown_understanding') {
      expect(decision.text).toContain('begrijp');
    }
  });

  it('asks for the highest-priority missing fact first (symptom before device)', () => {
    const context = contextWithIntent('incident');
    const calc = calculation(['symptom', 'serviceOrApplication', 'device'], ['symptom', 'serviceOrApplication', 'device']);
    const decision = decide(context, calc, []);
    expect(decision.kind).toBe('missing_information');
    if (decision.kind === 'missing_information') {
      expect(decision.nextQuestion.category).toBe('symptom');
      expect(decision.nextQuestion.text).toBe(FACT_QUESTIONS.symptom);
      expect(decision.missingFacts).toEqual(['symptom', 'serviceOrApplication', 'device']);
    }
  });

  it('requires clarification for genuine ambiguity on a required fact', () => {
    const context = contextWithIntent('incident');
    const calc = calculation(['symptom', 'device'], []);
    const ambiguities: readonly Ambiguity[] = [{ category: 'device', values: ['laptop', 'telefoon'] }];
    const decision = decide(context, calc, ambiguities);
    expect(decision.kind).toBe('clarification_required');
    if (decision.kind === 'clarification_required') {
      expect(decision.fact).toBe('device');
      expect(decision.reason).toBe('multiple_values_supplied');
      expect(decision.text).toContain(FACT_QUESTIONS.device);
    }
  });

  it('ignores ambiguity for a category the active rules do not require', () => {
    const context = contextWithIntent('incident');
    const calc = calculation(['symptom'], []);
    const ambiguities: readonly Ambiguity[] = [{ category: 'device', values: ['laptop', 'telefoon'] }];
    const decision = decide(context, calc, ambiguities);
    expect(decision.kind).toBe('sufficient_understanding');
  });

  it('returns the security-sensitive route with active indicators', () => {
    const context = contextWithIntent('phishing');
    setFactRecord(context, 'securityIndicators', {
      value: 'suspicious_link_clicked, credentials_entered_after_suspicious_link',
      kind: 'derived',
      confidence: 'high',
      sourceRuleId: 'security_indicator_aggregate',
      evidence: ['sec_link_clicked', 'sec_credentials_entered'],
      capturedAtTurn: 1,
    });
    const decision = decide(context, calculation(['securityIndicators'], []), []);
    expect(decision.kind).toBe('security_sensitive_route');
    if (decision.kind === 'security_sensitive_route') {
      expect(decision.indicators).toEqual([
        'suspicious_link_clicked',
        'credentials_entered_after_suspicious_link',
      ]);
    }
  });

  it('returns sufficient understanding when everything relevant is known', () => {
    const decision = decide(contextWithIntent('incident'), calculation(['symptom'], []), []);
    expect(decision.kind).toBe('sufficient_understanding');
  });

  it('has a Dutch question template for every fact category', () => {
    const categories = [
      'symptom',
      'serviceOrApplication',
      'device',
      'requestedResource',
      'securityIndicators',
      'startTime',
      'location',
      'impact',
      'urgency',
      'affectedUsers',
      'attemptedSolutions',
    ];
    for (const category of categories) {
      expect(FACT_QUESTIONS[category as keyof typeof FACT_QUESTIONS].length).toBeGreaterThan(0);
    }
    expect(Object.keys(FACT_QUESTIONS)).toHaveLength(categories.length);
  });
});
