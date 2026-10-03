/**
 * Deterministic fact extraction (BUILD_02.md par. 2).
 *
 * Extracts service-desk facts from normalized employee input where they can
 * be determined reliably. Unknown facts remain unknown; no default is ever
 * invented. Direct textual mentions (catalogue recognition, phrase-mapped
 * explicit facts) are explicit; interpreted conclusions (symptom, security
 * indicators) are derived and carry rule/evidence metadata.
 */
import type { FactCategory, FactRecord, SecurityIndicator } from './facts';
import type { ConversationIntent } from './intent-classification';
import {
  AFFECTED_USERS_PHRASE_RULES,
  ATTEMPTED_SOLUTIONS_PHRASE_RULES,
  IMPACT_PHRASE_RULES,
  LOCATION_PHRASE_RULES,
  SECURITY_PHRASE_RULES,
  SYMPTOM_PHRASE_RULES,
  SYMPTOM_RULE_VALUES,
  TIME_PHRASE_RULES,
  URGENCY_PHRASE_RULES,
  type PhraseRule,
} from './language-patterns';
import {
  recognizeSubjects,
  type RecognitionCatalog,
  type RecognizedSubject,
} from './recognition-catalog';

/** A category for which the message supplied multiple distinct values. */
export interface Ambiguity {
  readonly category: FactCategory;
  readonly values: readonly string[];
}

export interface ExtractedFact {
  readonly category: FactCategory;
  readonly record: FactRecord;
}

export interface FactExtractionResult {
  readonly facts: readonly ExtractedFact[];
  readonly ambiguities: readonly Ambiguity[];
  readonly subjects: readonly RecognizedSubject[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "maar <subject> wel" pattern: the subject is explicitly stated to be
 * working and must not be extracted as the broken application/device.
 */
function mentionedAsWorking(normalizedInput: string, subject: RecognizedSubject): boolean {
  const pattern = new RegExp(
    '\\bmaar\\b[^.!?]*\\b' + escapeRegExp(subject.matched) + '\\b[^.!?]*\\bwel\\b',
  );
  return pattern.test(normalizedInput);
}

function firstMatch(rules: readonly PhraseRule[], text: string): { ruleId: string; matched: string } | undefined {
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (match) {
      return { ruleId: rule.ruleId, matched: match[0] };
    }
  }
  return undefined;
}

/**
 * Extract facts from one normalized employee message.
 *
 * For phishing intent, subject facts (application/device) are deliberately
 * not extracted: the security case uses security clarification requirements,
 * and mentions like "mail" or "wachtwoord" inside a phishing report must not
 * pollute the service context.
 */
export function extractFacts(
  normalizedInput: string,
  catalog: RecognitionCatalog,
  capturedAtTurn: number,
  intent: ConversationIntent,
): FactExtractionResult {
  const allSubjects = recognizeSubjects(normalizedInput, catalog);
  const workingSubjects = allSubjects.filter((subject) => mentionedAsWorking(normalizedInput, subject));
  const subjects = allSubjects.filter((subject) => !workingSubjects.includes(subject));
  const facts: ExtractedFact[] = [];
  const ambiguities: Ambiguity[] = [];

  if (intent !== 'phishing') {
    for (const kind of ['application', 'device'] as const) {
      const category: FactCategory = kind === 'application' ? 'serviceOrApplication' : 'device';
      const hits = subjects.filter((s) => s.kind === kind).map((s) => s.canonical);
      const distinct = [...new Set(hits)];
      if (distinct.length === 1) {
        const canonical = distinct[0];
        const matched = subjects.find((s) => s.kind === kind && s.canonical === canonical)?.matched ?? canonical;
        if (canonical !== undefined) {
          facts.push({
            category,
            record: { value: canonical, kind: 'explicit', evidence: [matched], capturedAtTurn },
          });
        }
      } else if (distinct.length > 1) {
        // Genuinely ambiguous: no fact is set; the decision layer may ask
        // for clarification where the active rules require one value.
        ambiguities.push({ category, values: distinct });
      }
    }
  }

  // Security indicators (derived; evidence carries the safe rule ids).
  const indicators: SecurityIndicator[] = [];
  const indicatorRuleIds: string[] = [];
  for (const rule of SECURITY_PHRASE_RULES) {
    if (rule.pattern.test(normalizedInput)) {
      indicators.push(rule.indicator);
      indicatorRuleIds.push(rule.ruleId);
    }
  }
  if (indicators.length > 0) {
    facts.push({
      category: 'securityIndicators',
      record: {
        value: [...new Set(indicators)].join(', '),
        kind: 'derived',
        sourceRuleId: 'security_indicator_aggregate',
        evidence: [...new Set(indicatorRuleIds)],
        capturedAtTurn,
      },
    });
  }

  // Derived symptom (first matching rule wins; fixed rule order).
  const symptom = firstMatch(SYMPTOM_PHRASE_RULES, normalizedInput);
  if (symptom) {
    const value = SYMPTOM_RULE_VALUES[symptom.ruleId];
    if (value !== undefined) {
      facts.push({
        category: 'symptom',
        record: { value, kind: 'derived', sourceRuleId: symptom.ruleId, evidence: [symptom.matched], capturedAtTurn },
      });
    }
  }

  // Explicit phrase-mapped facts: value is the employee's own wording.
  const explicitPhraseRules: readonly (readonly [FactCategory, readonly PhraseRule[]])[] = [
    ['startTime', TIME_PHRASE_RULES],
    ['location', LOCATION_PHRASE_RULES],
    ['impact', IMPACT_PHRASE_RULES],
    ['urgency', URGENCY_PHRASE_RULES],
    ['affectedUsers', AFFECTED_USERS_PHRASE_RULES],
    ['attemptedSolutions', ATTEMPTED_SOLUTIONS_PHRASE_RULES],
  ];
  for (const [category, rules] of explicitPhraseRules) {
    const match = firstMatch(rules, normalizedInput);
    if (match) {
      facts.push({
        category,
        record: { value: match.matched, kind: 'explicit', sourceRuleId: match.ruleId, evidence: [match.matched], capturedAtTurn },
      });
    }
  }

  // Requested resource/target for requests (unknown stays unknown: no default).
  if (intent === 'request' && subjects.length > 0) {
    const first = subjects[0];
    if (first) {
      facts.push({
        category: 'requestedResource',
        record: { value: first.canonical, kind: 'explicit', evidence: [first.matched], capturedAtTurn },
      });
    }
  }

  return { facts, ambiguities, subjects };
}
