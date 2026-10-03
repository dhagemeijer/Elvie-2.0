/**
 * Conditional missing-information engine (BUILD_02.md par. 5).
 *
 * There is deliberately NO static required-fact list per intent: requirements
 * are calculated from intent + known facts + recognized subject + applicable
 * deterministic requirement rules. This prevents irrelevant questions (a
 * printer incident must not require an application; an account problem must
 * not automatically require a device).
 *
 * NEVER KNOWINGLY ASK TWICE is enforced here as business logic: any category
 * that already has a reliable fact (or a recorded answer) is never missing
 * and therefore never asked again.
 *
 * Build 02 ships the mechanism plus a small fictional rule set; full
 * production intake requirements remain Build 04.
 */
import type { ConversationContext } from './conversation-context';
import { getFact, hasReliableFact } from './conversation-context';
import type { FactCategory } from './facts';
import type { ConversationIntent } from './intent-classification';

export interface RequirementRuleCondition {
  /** Applicable only for this intent (all intents when omitted). */
  readonly intent?: ConversationIntent;
  /** Applicable when any of these recognized subject values is active. */
  readonly subjectIn?: readonly string[];
}

export interface RequirementRule {
  readonly ruleId: string;
  readonly when: RequirementRuleCondition;
  /** Categories this rule requires (when applicable). */
  readonly require?: readonly FactCategory[];
  /** Categories this rule suppresses (when applicable), e.g. irrelevant ones. */
  readonly suppress?: readonly FactCategory[];
}

/**
 * Fictional Build 02 rule set (documented behaviors per BUILD_02.md par. 5):
 * - printer incident must not require an application;
 * - account problem must not automatically require a device;
 * - application problem may require a device where relevant;
 * - access request requires the requested resource/target;
 * - security case uses the applicable security clarification requirements.
 */

export const FICTIONAL_REQUIREMENT_RULES: readonly RequirementRule[] = [
  {
    ruleId: 'req_incident_core',
    when: { intent: 'incident' },
    require: ['symptom', 'serviceOrApplication'],
  },
  {
    ruleId: 'req_incident_device_relevant',
    when: { intent: 'incident', subjectIn: ['Outlook', 'Teams', 'Mailbox'] },
    require: ['device'],
  },
  {
    ruleId: 'req_device_subject_no_application',
    when: { intent: 'incident', subjectIn: ['laptop', 'telefoon', 'printer', 'desktop', 'muis'] },
    suppress: ['serviceOrApplication'],
  },
  {
    ruleId: 'req_account_no_device',
    when: { intent: 'incident', subjectIn: ['Account'] },
    suppress: ['device'],
  },
  {
    ruleId: 'req_request_resource',
    when: { intent: 'request' },
    require: ['requestedResource'],
  },
  {
    ruleId: 'req_security_indicators',
    when: { intent: 'phishing' },
    require: ['securityIndicators'],
  },
];

/** Fixed, documented priority order for missing facts and next questions. */
export const FACT_CATEGORY_PRIORITY: readonly FactCategory[] = [
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

export interface MissingInformationCalculation {
  /** Required categories after suppression, in fixed priority order. */
  readonly required: readonly FactCategory[];
  /** Required categories that are not reliably known yet. */
  readonly missing: readonly FactCategory[];
}

function ruleApplies(
  condition: RequirementRuleCondition,
  intent: ConversationIntent,
  subjectValues: readonly string[],
): boolean {
  if (condition.intent !== undefined && condition.intent !== intent) {
    return false;
  }
  if (condition.subjectIn !== undefined && !condition.subjectIn.some((s) => subjectValues.includes(s))) {
    return false;
  }
  return true;
}

/**
 * Calculate the relevant required and missing fact categories from the
 * current intent, known facts, recognized subject and applicable rules.
 * Deterministic: identical context and rules produce an identical result.
 */
export function calculateMissingFacts(
  context: ConversationContext,
  rules: readonly RequirementRule[],
): MissingInformationCalculation {
  const intent = context.intentClassification?.value ?? context.intent ?? 'unknown';
  const subjectValues = [getFact(context, 'serviceOrApplication')?.value, getFact(context, 'device')?.value].filter(
    (value): value is string => value !== undefined,
  );
  const required = new Set<FactCategory>();
  const suppressed = new Set<FactCategory>();
  for (const rule of rules) {
    if (!ruleApplies(rule.when, intent, subjectValues)) {
      continue;
    }
    for (const category of rule.require ?? []) {
      required.add(category);
    }
    for (const category of rule.suppress ?? []) {
      suppressed.add(category);
    }
  }
  for (const category of suppressed) {
    required.delete(category);
  }
  const orderedRequired = FACT_CATEGORY_PRIORITY.filter((category) => required.has(category));
  const missing = orderedRequired.filter((category) => !hasReliableFact(context, category));
  return { required: orderedRequired, missing };
}
