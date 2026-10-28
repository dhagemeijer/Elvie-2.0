/**
 * ELVIE 2.0 — BUILD 04B — Typed answer outcomes (§6.1/§15.2).
 *
 * Deterministic classification of free-text answers into concrete,
 * explicit_unknown or invalid. Raw free text is never automatically
 * treated as validated; sensitive values are never retained (never in
 * facts, answers, previews, drafts or logs).
 */
import type { ConversationContext } from './conversation-context';
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

export function classifyAnswerOutcome(raw: string, capturedAtTurn: number): AnswerOutcome {
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
