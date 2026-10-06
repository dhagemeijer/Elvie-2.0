/**
 * Conversation Core pipeline (BUILD_02.md "Goal"):
 *
 * employee input -> normalisation -> intent classification -> fact extraction
 *   -> context merge -> conditional missing-information calculation -> decision
 *
 * Pure and deterministic: identical input, ConversationContext,
 * RecognitionCatalog and requirement rules produce an identical result. No
 * wall-clock time, randomness, network or LLM is involved. The core never
 * changes ConversationState: the Build 01 state machine stays authoritative.
 */
import type { ConversationContext } from './conversation-context';
import { mergeExtractedFacts, mergeIntentClassification } from './context-merge';
import { decide, type ConversationDecision } from './conversation-decision';
import { extractFacts } from './fact-extraction';
import type { IntentClassification } from './intent-classification';
import { classifyIntent } from './intent-classification';
import { normalizeInput } from './normalisation';
import { recognizeSubjects, FICTIONAL_RECOGNITION_CATALOG, type RecognitionCatalog } from './recognition-catalog';
import { calculateMissingFacts, FICTIONAL_REQUIREMENT_RULES, type RequirementRule } from './requirements';

export interface ConversationCoreOptions {
  /** Recognition vocabulary; defaults to the fictional dev/test catalogue. */
  readonly catalog?: RecognitionCatalog;
  /** Requirement rules; defaults to the fictional Build 02 rule set. */
  readonly requirementRules?: readonly RequirementRule[];
}

export interface ConversationCoreResult {
  readonly decision: ConversationDecision;
  readonly classification: IntentClassification;
}

/**
 * Process one raw employee message against the context and produce the
 * deterministic conversation decision. Mutates only the context's
 * classification, facts and turn data; never its conversation state.
 */
export function processEmployeeMessage(
  context: ConversationContext,
  rawInput: string,
  options: ConversationCoreOptions = {},
): ConversationCoreResult {
  const catalog = options.catalog ?? FICTIONAL_RECOGNITION_CATALOG;
  const rules = options.requirementRules ?? FICTIONAL_REQUIREMENT_RULES;

  // 1. Deterministic normalisation.
  const normalized = normalizeInput(rawInput);

  // 2. Intent classification (subjects recognized via the catalogue).
  const subjects = recognizeSubjects(normalized, catalog);
  const classification = classifyIntent(normalized, subjects);
  mergeIntentClassification(context, classification);
  const effectiveIntent = context.intentClassification?.value ?? classification.value;

  // 3. Fact extraction + 4. context merge with precedence rules.
  const extraction = extractFacts(normalized, catalog, context.currentTurn, effectiveIntent);
  mergeExtractedFacts(context, extraction, normalized);

  // 5. Conditional missing-information calculation (never knowingly ask twice).
  const calculation = calculateMissingFacts(context, rules);

  // 6. Deterministic decision.
  const decision = decide(context, calculation, extraction.ambiguities);
  return { decision, classification };
}
