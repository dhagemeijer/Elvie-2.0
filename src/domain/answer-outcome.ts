/**
 * ELVIE 2.0 — BUILD 04B — Typed answer outcomes (§6.1/§15.2).
 *
 * Deterministic classification of free-text answers into concrete,
 * explicit_unknown or invalid. Raw free text is never automatically
 * treated as validated; sensitive values are never retained (never in
 * facts, answers, previews, drafts or logs).
 *
 * BUILD 04 §15.2: classification is field-specific. General text checks
 * (length, bare commands, sensitive values) apply to every answer, but a
 * CONCRETE verdict additionally requires that the answer is substantively
 * usable for the specific required field: a bare device or application
 * name is not a problem description, and a bare application name is not
 * a device. Meaningful free text is always preserved; no generative AI
 * and no rigid keyword list of content words is used.
 */
import type { ConversationContext } from './conversation-context';
import type { FactCategory } from './facts';
import { FICTIONAL_RECOGNITION_CATALOG } from './recognition-catalog';
import { containsSensitiveValue } from '../security/sensitive-values';

export type AnswerOutcome =
  | { readonly kind: 'concrete'; readonly value: string; readonly capturedAtTurn: number }
  | { readonly kind: 'explicit_unknown'; readonly capturedAtTurn: number }
  | { readonly kind: 'invalid'; readonly reasonCode: string; readonly capturedAtTurn: number };

/**
 * Deterministic, exact (normalized) set of explicit unknown answers.
 * Anything else is never silently interpreted as "unknown".
 */
export const EXPLICIT_UNKNOWN_ANSWERS: readonly string[] = [
  'weet niet',
  'weet ik niet',
  'ik weet het niet',
  'ik weet niet',
  'geen idee',
  'onbekend',
  'niet bekend',
];

/** Bare confirmation/feedback words are never usable field answers (F-16). */
const BARE_COMMAND_WORDS: readonly string[] = [
  'ja',
  'yes',
  'nee',
  'no',
  'ok',
  'oké',
  'klaar',
  'bevestig',
  'bevestigen',
  'verstuur',
  'versturen',
  'verzend',
  'verzenden',
];

/**
 * Trivial Dutch glue words ignored when deciding whether an answer adds
 * anything beyond recognized device/application names. This is NOT a
 * keyword list for content: it contains only words that carry no
 * substantive meaning on their own.
 */
const GLUE_WORDS: ReadonlySet<string> = new Set([
  'de',
  'het',
  'een',
  'mijn',
  'jouw',
  'van',
  'op',
  'in',
  'is',
  'zijn',
  'dat',
  'die',
  'deze',
  'en',
  'of',
  'met',
  'voor',
  'aan',
  'bij',
  'er',
  'niet',
  'geen',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-bounded removal of one catalogue alias from an answer. */
function stripAlias(normalized: string, alias: string): string {
  return normalized.replace(new RegExp('\\b' + escapeRegExp(alias) + '\\b', 'g'), ' ');
}

/**
 * True when the answer consists solely of recognized subject names of the
 * given kind(s) plus trivial glue words: no substantive content remains.
 * Deterministic and explainable: it reuses only the existing recognition
 * catalogue aliases, never an invented content vocabulary.
 */
function isBareSubjectAnswer(
  normalized: string,
  kind: 'device' | 'application' | 'both',
): boolean {
  let stripped = normalized;
  if (kind !== 'application') {
    for (const entry of FICTIONAL_RECOGNITION_CATALOG.devices) {
      for (const alias of entry.aliases) {
        stripped = stripAlias(stripped, alias);
      }
    }
  }
  if (kind !== 'device') {
    for (const entry of FICTIONAL_RECOGNITION_CATALOG.applications) {
      for (const alias of entry.aliases) {
        stripped = stripAlias(stripped, alias);
      }
    }
  }
  return stripped.split(/\s+/).every((word) => word.length === 0 || GLUE_WORDS.has(word));
}

/**
 * BUILD 04 §15.2: is this answer substantively usable for the specific
 * required field? Descriptive fields (a symptom or request objective) need
 * more than a bare device/application name; a device answer is not a bare
 * application name and vice versa. All other meaningful free text stays
 * concrete.
 */
function isUsableAnswerForField(normalized: string, field: FactCategory): boolean {
  switch (field) {
    case 'symptom':
    case 'requestedResource':
      // A problem description or request objective must describe
      // something; a bare device or application name does not.
      return !isBareSubjectAnswer(normalized, 'both');
    case 'device':
      // A device answer is not completed by a bare application name.
      return !isBareSubjectAnswer(normalized, 'application');
    case 'serviceOrApplication':
      // An application answer is not completed by a bare device name.
      return !isBareSubjectAnswer(normalized, 'device');
    default:
      return true;
  }
}

export function classifyAnswerOutcome(
  raw: string,
  capturedAtTurn: number,
  field?: FactCategory,
): AnswerOutcome {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    return { kind: 'invalid', reasonCode: 'empty_answer', capturedAtTurn };
  }
  if (EXPLICIT_UNKNOWN_ANSWERS.includes(normalized)) {
    return { kind: 'explicit_unknown', capturedAtTurn };
  }
  if (containsSensitiveValue(raw)) {
    // Never retained: no secrets in facts, answers, previews, drafts or logs.
    return { kind: 'invalid', reasonCode: 'prohibited_value', capturedAtTurn };
  }
  if (normalized.length < 3 || normalized.length > 500) {
    return { kind: 'invalid', reasonCode: 'unusable_answer', capturedAtTurn };
  }
  if (BARE_COMMAND_WORDS.includes(normalized)) {
    return { kind: 'invalid', reasonCode: 'unusable_answer', capturedAtTurn };
  }
  // BUILD 04 §15.2: field-specific usability for a CONCRETE verdict. An
  // irrelevant answer for the required field is invalid (bounded retry);
  // meaningful free text stays concrete.
  if (field !== undefined && !isUsableAnswerForField(normalized, field)) {
    return { kind: 'invalid', reasonCode: 'irrelevant_answer', capturedAtTurn };
  }
  return { kind: 'concrete', value: raw.trim(), capturedAtTurn };
}

export function recordAnswerOutcome(
  context: ConversationContext,
  questionKey: string,
  outcome: AnswerOutcome,
): void {
  (context.answerOutcomes as Record<string, AnswerOutcome>)[questionKey] = outcome;
}

export function getAnswerOutcome(
  context: ConversationContext,
  questionKey: string,
): AnswerOutcome | undefined {
  return context.answerOutcomes?.[questionKey];
}

/** Remove a superseded typed outcome (I-08: a newer structured fact wins). */
export function clearAnswerOutcome(context: ConversationContext, questionKey: string): void {
  delete (context.answerOutcomes as Record<string, AnswerOutcome>)[questionKey];
}
