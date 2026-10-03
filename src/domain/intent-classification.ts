/**
 * Deterministic intent classification (BUILD_02.md par. 1).
 *
 * Classification is rule-based, ordered and explainable: the result carries a
 * value, a qualitative confidence (high | medium | low; never
 * pseudo-statistical) and concise rule-id/phrase evidence. "unknown" is a
 * valid, safe result: insufficient evidence is never converted into a
 * confident classification just to keep the conversation moving.
 *
 * Documented fixed evaluation order: security rules first (conservative),
 * then incident, then request. Ties resolve by this order, never randomly.
 */
import type { QualitativeConfidence } from './facts';
import {
  REQUEST_PHRASE_RULES,
  SECURITY_PHRASE_RULES,
  SYMPTOM_PHRASE_RULES,
  type PhraseRule,
} from './language-patterns';
import type { RecognizedSubject } from './recognition-catalog';

export type ConversationIntent = 'incident' | 'request' | 'phishing' | 'unknown';

/** One piece of concise classification evidence: a stable rule id + matched span. */
export interface IntentEvidence {
  readonly ruleId: string;
  readonly matched: string;
}

/** Explainable classification result (BUILD_02.md par. 1). */
export interface IntentClassification {
  readonly value: ConversationIntent;
  readonly confidence: QualitativeConfidence;
  readonly evidence: readonly IntentEvidence[];
}

function matchRules(rules: readonly PhraseRule[], text: string): readonly IntentEvidence[] {
  const evidence: IntentEvidence[] = [];
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (match) {
      evidence.push({ ruleId: rule.ruleId, matched: match[0] });
    }
  }
  return evidence;
}

/**
 * Classify the intent of a normalized employee message, given the recognized
 * subjects. Deterministic: identical input and subjects produce an identical
 * result.
 */
export function classifyIntent(
  normalizedInput: string,
  subjects: readonly RecognizedSubject[],
): IntentClassification {
  // 1. Security/phishing first (conservative and deterministic).
  const securityEvidence = matchRules(
    SECURITY_PHRASE_RULES.map((rule) => ({ ruleId: rule.ruleId, pattern: rule.pattern })),
    normalizedInput,
  );
  if (securityEvidence.length > 0) {
    const onlySuspiciousMessage = securityEvidence.every((e) => e.ruleId === 'sec_suspicious_message');
    return {
      value: 'phishing',
      confidence: onlySuspiciousMessage ? 'medium' : 'high',
      evidence: securityEvidence,
    };
  }

  // 2. Incident: a symptom phrase requires a recognized subject; a symptom
  //    without any subject is insufficient evidence and stays unknown.
  const symptomEvidence = matchRules(SYMPTOM_PHRASE_RULES, normalizedInput);
  if (symptomEvidence.length > 0) {
    if (subjects.length > 0) {
      return { value: 'incident', confidence: 'high', evidence: symptomEvidence };
    }
    return { value: 'unknown', confidence: 'low', evidence: symptomEvidence };
  }

  // 3. Request.
  const requestEvidence = matchRules(REQUEST_PHRASE_RULES, normalizedInput);
  if (requestEvidence.length > 0) {
    return {
      value: 'request',
      confidence: subjects.length > 0 ? 'high' : 'medium',
      evidence: requestEvidence,
    };
  }

  // 4. Unknown is a safe, valid result.
  return { value: 'unknown', confidence: 'low', evidence: [] };
}
