import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../src/domain/conversation-context';
import { createConversationContext, getFact } from '../src/domain/conversation-context';
import { processEmployeeMessage } from '../src/domain/conversation-core';
import { extractFacts } from '../src/domain/fact-extraction';
import { classifyIntent } from '../src/domain/intent-classification';
import { normalizeInput } from '../src/domain/normalisation';
import {
  FICTIONAL_RECOGNITION_CATALOG,
  recognizeSubjects,
} from '../src/domain/recognition-catalog';

/**
 * Regression coverage for the two independent review fixes:
 * 1. derived facts carry qualitative confidence (high | medium | low);
 * 2. the composite credentials_entered_after_suspicious_link indicator is
 *    composed only from a credentials-entered signal AND a link-click signal
 *    in the same message; credentials alone never establish phishing.
 */

function classify(raw: string) {
  const normalized = normalizeInput(raw);
  return classifyIntent(normalized, recognizeSubjects(normalized, FICTIONAL_RECOGNITION_CATALOG));
}

function extract(raw: string, intent: 'incident' | 'request' | 'phishing' | 'unknown' = 'incident') {
  return extractFacts(normalizeInput(raw), FICTIONAL_RECOGNITION_CATALOG, 1, intent);
}

function factOf(result: ReturnType<typeof extract>, category: string) {
  return result.facts.find((f) => f.category === category)?.record;
}

function newContext(): ConversationContext {
  return createConversationContext('session-test', '2026-10-03T12:00:00.000Z');
}

/** The engine owns the logical turn counter; tests simulate its increment. */
function turn(context: ConversationContext, input: string) {
  context.currentTurn += 1;
  return processEmployeeMessage(context, input);
}

describe('Review fix 1: qualitative confidence on derived facts', () => {
  it('marks the derived symptom with medium confidence (fails without the confidence fix)', () => {
    const result = extract('Mijn Outlook doet het niet.');
    const symptom = factOf(result, 'symptom');
    expect(symptom).toMatchObject({ kind: 'derived', confidence: 'medium' });
    expect(symptom?.sourceRuleId).toBeDefined();
    expect(symptom?.evidence?.length ?? 0).toBeGreaterThan(0);
  });

  it('marks derived security indicators with high confidence (fails without the confidence fix)', () => {
    const result = extract('Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.', 'phishing');
    const indicators = factOf(result, 'securityIndicators');
    expect(indicators).toMatchObject({ kind: 'derived', confidence: 'high' });
    expect(indicators?.sourceRuleId).toBe('security_indicator_aggregate');
  });

  it('never attaches inferred confidence to an explicit fact', () => {
    const result = extract('Mijn Outlook doet het niet.');
    const application = factOf(result, 'serviceOrApplication');
    expect(application).toMatchObject({ kind: 'explicit', value: 'Outlook' });
    expect(application?.confidence).toBeUndefined();
  });

  it('carries derived fact confidence through the context merge', () => {
    const incident = newContext();
    turn(incident, 'Mijn Outlook doet het niet.');
    expect(getFact(incident, 'symptom')).toMatchObject({ kind: 'derived', confidence: 'medium' });

    const security = newContext();
    turn(security, 'Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.');
    expect(getFact(security, 'securityIndicators')).toMatchObject({ kind: 'derived', confidence: 'high' });
  });
});

describe('Review fix 2: conservative security indicator composition (classification)', () => {
  it('does not conclude phishing from credentials alone ("ingevuld")', () => {
    const result = classify('Ik heb mijn wachtwoord ingevuld.');
    expect(result).toEqual({ value: 'unknown', confidence: 'low', evidence: [] });
  });

  it('does not conclude phishing from credentials alone ("ingevoerd")', () => {
    const result = classify('Ik
 heb mijn wachtwoord ingevoerd.');
    expect(result.value).toBe('unknown');
    expect(result.confidence).toBe('low');
  });

  it('composes the credentials indicator only together with a link click', () => {
    const raw = 'Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.';
    const result = classify(raw);
    expect(result.value).toBe('phishing');
    expect(result.confidence).toBe('high');
    expect(result.evidence.map((e) => e.ruleId)).toEqual(['sec_link_clicked', 'sec_credentials_composite']);

    const indicators = factOf(extract(raw, 'phishing'), 'securityIndicators');
    expect(indicators?.value).toBe('suspicious_link_clicked, credentials_entered_after_suspicious_link');
    expect(indicators?.evidence).toEqual(['sec_link_clicked', 'sec_credentials_entered']);
  });

  it('composes all applicable indicators for a link in a strange mail followed by credentials', () => {
    const raw = 'Ik heb op een link in een vreemde mail geklikt en daarna mijn wachtwoord ingevuld.';
    const result = classify(raw);
    expect(result.value).toBe('phishing');
    expect(result.evidence.map((e) => e.ruleId)).toEqual([
      'sec_suspicious_message',
      'sec_link_clicked',
      'sec_credentials_composite',
    ]);

    const indicators = factOf(extract(raw, 'phishing'), 'securityIndicators');
    expect(indicators?.value).toBe(
      'suspicious_message_received, suspicious_link_clicked, credentials_entered_after_suspicious_link',
    );
  });

  it('keeps "Mijn wachtwoord werkt niet." an incident, not phishing', () => {
    const result = classify('Mijn wachtwoord werkt niet.');
    expect(result.value).toBe('incident');
    expect(result.confidence).toBe('high');
  });

  it('keeps "Ik wil mijn wachtwoord wijzigen." a request, not phishing', () => {
    const result = classify('Ik wil mijn wachtwoord wijzigen.');
    expect(result.value).toBe('request');
  });
});

describe('Review fix 2 at Conversation Core level', () => {
  it('keeps credentials alone safely unknown with no security indicators', () => {
    const context = newContext();
    const { decision, classification } = turn(context, 'Ik heb mijn wachtwoord ingevuld.');
    expect(classification.value).toBe('unknown');
    expect(decision.kind).toBe('unknown_understanding');
    expect(getFact(context, 'securityIndicators')).toBeUndefined();
  });

  it('routes the full suspicious-mail report with all three indicators and high derived confidence', () => {
    const context = newContext();
    const { decision } = turn(
      context,
      'Ik heb op een link in een vreemde mail geklikt en daarna mijn wachtwoord ingevuld.',
    );
    expect(decision.kind).toBe('security_sensitive_route');
    if (decision.kind === 'security_sensitive_route') {
      expect(decision.indicators).toEqual([
        'suspicious_message_received',
        'suspicious_link_clicked',
        'credentials_entered_after_suspicious_link',
      ]);
    }
    expect(getFact(context, 'securityIndicators')).toMatchObject({ kind: 'derived', confidence: 'high' });
  });

  it('resolves "Mijn wachtwoord werkt niet." as an account incident, not a security case', () => {
    const context = newContext();
    const { decision, classification } = turn(context, 'Mijn wachtwoord werkt niet.');
    expect(classification.value).toBe('incident');
    expect(decision.kind).toBe('sufficient_understanding');
  });

  it('resolves "Ik wil mijn wachtwoord wijzigen." as a request, not a security case', () => {
    const context = newContext();
    const { decision, classification } = turn(context, 'Ik wil mijn wachtwoord wijzigen.');
    expect(classification.value).toBe('request');
    expect(decision.kind).toBe('sufficient_understanding');
  });
});
