/**
 * Deterministic context merge: fact precedence and conflict resolution
 * (BUILD_02.md par. 3).
 *
 * Precedence rules:
 * 1. explicit > derived;
 * 2. derived never silently overwrites an explicit value;
 * 3. a later explicit fact replaces an earlier explicit value whenever the
 *    new utterance unambiguously supplies a new value for the same category
 *    (correction markers like "sorry"/"trouwens"/"ik bedoel" may strengthen
 *    detection but are NOT required);
 * 4. ambiguous multi-value input never replaces an existing fact; it is
 *    surfaced to the decision layer which may ask for clarification;
 * 5. uncertainty is never resolved by guessing.
 *
 * No conversation transcript is retained: only the active FactRecord per
 * category plus its concise evidence is kept.
 */
import type { ConversationContext } from './conversation-context';
import { getFact, setFactRecord } from './conversation-context';
import type { FactExtractionResult } from './fact-extraction';
import { CORRECTION_MARKER_PATTERN } from './language-patterns';
import type { IntentClassification } from './intent-classification';

/** Correction markers (may strengthen/confirm detection; never required). */
export const CORRECTION_MARKERS: readonly string[] = ['sorry', 'trouwens', 'ik bedoel'];

/**
 * Merge a new classification into the context. An established classification
 * (medium/high, not unknown) is retained when a later message does not
 * produce a confident alternative: a low/unknown result never overwrites an
 * established intent. A later confident classification does replace it.
 */
export function mergeIntentClassification(context: ConversationContext, classification: IntentClassification): void {
  const current = context.intentClassification;
  const established =
    current !== undefined && current.value !== 'unknown' && (current.confidence === 'high' || current.confidence === 'medium');
  const confident = classification.value !== 'unknown' && classification.confidence !== 'low';
  if (!established || confident) {
    context.intentClassification = classification;
    context.intent = classification.value;
  }
}

/**
 * Merge extracted facts into the context per the precedence rules above.
 * normalizedInput is used only to detect correction markers for evidence.
 */
export function mergeExtractedFacts(
  context: ConversationContext,
  extraction: FactExtractionResult,
  normalizedInput: string,
): void {
  const hasCorrectionMarker = CORRECTION_MARKER_PATTERN.test(normalizedInput);
  for (const { category, record } of extraction.facts) {
    const existing = getFact(context, category);
    if (existing === undefined) {
      setFactRecord(context, category, record);
      continue;
    }
    if (record.kind === 'derived') {
      // Derived never overwrites an explicit value; later derived replaces earlier derived.
      if (existing.kind === 'explicit') {
        continue;
      }
      setFactRecord(context, category, record);
      continue;
    }
    if (existing.value === record.value) {
      // Same value again: refresh the logical turn marker, never re-ask.
      setFactRecord(context, category, record);
      continue;
    }
    // Later unambiguous explicit value replaces any earlier value.
    const evidence =
      hasCorrectionMarker && record.evidence ? [...record.evidence, 'correction_marker'] : record.evidence;
    setFactRecord(context, category, { ...record, evidence });
  }
}
