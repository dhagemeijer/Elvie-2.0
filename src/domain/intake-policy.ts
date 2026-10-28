/**
 * ELVIE 2.0 — BUILD 04B — Typed intake field policies and validation
 * (BUILD_04 §6, §15.2).
 *
 * Deterministic validation of the generic intake from the SINGLE
 * engine-owned effective ticket category plus the functional route. Raw
 * free text is never automatically validated: only structured facts and
 * typed concrete answer outcomes count as concrete; an accepted explicit
 * unknown completes a required-answer field but never a required-concrete
 * one; a contradiction between a concrete fact and an accepted explicit
 * unknown for the same essential field requires clarification (I-08).
 */
import type { ConversationContext, IntakeType } from './conversation-context';
import { getFact } from './conversation-context';
import type { FactCategory } from './facts';
import { getAnswerOutcome, type AnswerOutcome } from './answer-outcome';
import {
  calculateMissingFactsForCategory,
  FICTIONAL_REQUIREMENT_RULES,
  type RequirementRule,
} from './requirements';

/** Field policies (BUILD_04 §6.2/§15.2). */
export type FieldPolicy =
  | 'required_concrete'
  | 'required_answer'
  | 'conditional'
  | 'optional'
  | 'prohibited';

/** Validation outcomes (BUILD_04 §6.3/§15.2). */
export type ValidationOutcome =
  | 'ready_for_preview'
  | 'needs_information'
  | 'clarification_required'
  | 'security_route_required';

/** Fields that may never be requested, derived or stored (§15.2/§15.6). */
export const PROHIBITED_FIELD_KEYS: readonly string[] = ['password', 'token', 'mfaCode', 'recoveryCode'];

/** Safe, fixed label for an accepted explicit unknown (§6.3.4/I-15). */
export const UNKNOWN_LABEL = 'niet bekend (volgens medewerker)';

/** Logical question keys mapped onto their requirement field. */
const QUESTION_KEY_TO_FIELD: Readonly<Record<string, FactCategory>> = {
  symptom_description: 'symptom',
};

function coreField(category: IntakeType): FactCategory {
  switch (category) {
    case 'request':
      return 'requestedResource';
    case 'security':
      return 'securityIndicators';
    default:
      return 'symptom';
  }
}

export function fieldPolicyFor(category: IntakeType, field: FactCategory): FieldPolicy {
  if (PROHIBITED_FIELD_KEYS.includes(field)) {
    return 'prohibited';
  }
  if (field === coreField(category)) {
    // A meaningful, safe problem description or request objective is the
    // minimum; a security case must remain confirmable for safe handling
    // even when details are unknown, so only an answer is required.
    return category === 'security' ? 'required_answer' : 'required_concrete';
  }
  return 'required_answer';
}

export interface IntakeFieldAssessment {
  readonly field: FactCategory;
  readonly policy: FieldPolicy;
  readonly status: 'concrete' | 'explicit_unknown' | 'invalid' | 'missing';
}

export interface IntakeValidationResult {
  readonly outcome: ValidationOutcome;
  readonly category: IntakeType;
  readonly route: string;
  readonly fields: readonly IntakeFieldAssessment[];
  readonly reasonCode: string;
  /** Required fields with an accepted explicit unknown (never re-asked). */
  readonly unknownFields: readonly FactCategory[];
}

function outcomeFor(context: ConversationContext, field: FactCategory): AnswerOutcome | undefined {
  const direct = getAnswerOutcome(context, field);
  if (direct !== undefined) {
    return direct;
  }
  for (const [key, target] of Object.entries(QUESTION_KEY_TO_FIELD)) {
    if (target === field) {
      return getAnswerOutcome(context, key);
    }
  }
  return undefined;
}

export function validateIntake(
  context: ConversationContext,
  category: IntakeType,
  route: string,
  rules: readonly RequirementRule[] = FICTIONAL_REQUIREMENT_RULES,
): IntakeValidationResult {
  const required = calculateMissingFactsForCategory(context, rules, category, route).required;
  const fields: IntakeFieldAssessment[] = [];
  const unknownFields: FactCategory[] = [];
  let contradiction = false;
  let needsInformation = false;
  for (const field of required) {
    if (PROHIBITED_FIELD_KEYS.includes(field)) {
      continue;
    }
    const policy = fieldPolicyFor(category, field);
    const fact = getFact(context, field);
    const outcome = outcomeFor(context, field);
    let status: IntakeFieldAssessment['status'];
    if (fact !== undefined || outcome?.kind === 'concrete') {
      status = 'concrete';
    } else if (outcome?.kind === 'explicit_unknown') {
      status = 'explicit_unknown';
    } else if (outcome?.kind === 'invalid') {
      status = 'invalid';
    } else {
      status = 'missing';
    }
    if (fact !== undefined && outcome?.kind === 'explicit_unknown') {
      // I-08: an essential field cannot be both known and explicitly
      // unknown; this needs clarification before a preview can confirm.
      status = 'invalid';
      contradiction = true;
    }
    if (status === 'explicit_unknown') {
      unknownFields.push(field);
    }
    if (status !== 'concrete' && policy === 'required_concrete') {
      needsInformation = true;
    }
    if ((status === 'missing' || status === 'invalid') && policy === 'required_answer') {
      needsInformation = true;
    }
    fields.push({ field, policy, status });
  }
  let result: ValidationOutcome;
  let reasonCode: string;
  if (category === 'security') {
    // A security case is never blocked on missing details: the safe
    // handling path always applies (§6.2/F-06).
    result = 'security_route_required';
    reasonCode = 'security_safe_handling';
  } else if (contradiction) {
    result = 'clarification_required';
    reasonCode = 'contradictory_essential_facts';
  } else if (needsInformation) {
    result = 'needs_information';
    reasonCode = 'required_field_unresolved';
  } else {
    result = 'ready_for_preview';
    reasonCode = 'none';
  }
  return { outcome: result, category, route, fields, reasonCode, unknownFields };
}
