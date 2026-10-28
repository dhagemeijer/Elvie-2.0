/**
 * ELVIE 2.0 — BUILD 04A — Server-owned material revision (§15.3).
 *
 * Central, deterministic comparison of the FULL material conversation
 * state before and after an accepted turn: the revision rises exactly
 * once per material change and never for administrative bookkeeping
 * alone. The revision is owned by the conversation engine (one counter
 * per session) and maintained serially: complete employee message
 * processing is serialised per session, so the comparison cannot
 * interleave.
 *
 * Routing clarification budgets couple to this revision (§15.3): at most
 * one targeted question per unchanged material situation; only a material
 * revision bump re-allows a question.
 */

import type { ConversationContext } from './conversation-context';
import { calculateMissingFacts, FACT_CATEGORY_PRIORITY, FICTIONAL_REQUIREMENT_RULES } from './requirements';

/**
 * Deterministic revision step (§15.3): identical material states keep the
 * current revision; any material change raises it by exactly one. Pure and
 * total: identical inputs always produce an identical result.
 */
export function nextMaterialRevision(before: string, after: string, currentRevision: number): number {
  return before === after ? currentRevision : currentRevision + 1;
}

/**
 * Canonical projection of ALL material conversation state (§15.3 final
 * remediation), replacing the five-field routing fingerprint for revision
 * management. Deterministic and key-ordered: identical material states
 * always produce an identical string.
 *
 * Included material state:
 * - effective intent (intent classification value);
 * - active FactRecords per documented priority with provenance
 *   (value, kind, derived confidence, concluding rule id, evidence);
 * - validated answers retained by the engine (never-knowingly-ask-twice);
 * - ticket category (intakeType) and security state (intakeType plus
 *   active securityIndicators value);
 * - relevant requirements/validation outcome (calculateMissingFacts:
 *   required and still-missing categories);
 * - the routing decision implied by the material context alone, passed in
 *   by the engine as a budget-independent snapshot (computed without
 *   clarification bookkeeping, so a spent clarification budget never
 *   masquerades as a material change).
 *
 * Deliberately EXCLUDED (administrative bookkeeping; refreshing it never
 * bumps the revision): currentTurn and capturedAtTurn ordering, the
 * turn-1 initial_question retention echo (traceability of the opening
 * message, not a validated answer to a category question), knowledge
 * phase/offered-article/unclear-feedback bookkeeping, the pending intake
 * category pointer and the submission attempt bookkeeping. Classification
 * confidence/evidence are explainability metadata of the same effective
 * intent and are therefore also excluded.
 */
export function materialStateProjection(context: ConversationContext, routingDecision: string): string {
  const facts = FACT_CATEGORY_PRIORITY.map((category) => {
    const record = context.facts[category];
    if (record === undefined) {
      return category + ':-';
    }
    const provenance = [
      record.value,
      record.kind,
      record.kind === 'derived' ? record.confidence : '-',
      record.sourceRuleId ?? '-',
      (record.evidence ?? []).join(','),
    ].join('~');
    return category + ':' + provenance;
  }).join('|');
  const answers = Object.keys(context.answers)
    .filter((key) => key !== 'initial_question')
    .sort()
    .map((key) => key + '~' + String(context.answers[key]))
    .join('|');
  // BUILD 04B §15.2: typed answer outcomes are material state (validated
  // concrete value, accepted unknown or invalid reason); capturedAtTurn is
  // administrative ordering and deliberately excluded.
  const typedAnswers = Object.keys(context.answerOutcomes ?? {})
    .sort()
    .map((key) => {
      const outcome = context.answerOutcomes?.[key];
      if (outcome === undefined) {
        return key + '~-';
      }
      const detail = outcome.kind === 'concrete' ? outcome.value : outcome.kind === 'invalid' ? outcome.reasonCode : '-';
      return key + '~' + outcome.kind + '~' + detail;
    })
    .join('|');
  const intent = context.intentClassification?.value ?? context.intent ?? 'unknown';
  const missing = calculateMissingFacts(context, FICTIONAL_REQUIREMENT_RULES);
  const security = [context.intakeType ?? '-', context.facts.securityIndicators?.value ?? '-'].join('~');
  return [
    'intent~' + intent,
    'facts~' + facts,
    'answers~' + answers,
    'typedAnswers~' + typedAnswers,
    'ticket~' + (context.intakeType ?? '-'),
    'security~' + security,
    'requirements~' + missing.required.join(',') + '~' + missing.missing.join(','),
    'routing~' + routingDecision,
  ].join('§');
}
