/**
 * Server-side safeguard for privacy-sensitive input.
 * Client-side checks are UX only; this module is the repeated server-side
 * control required by SECURITY_PRINCIPLES.md (principle 10).
 *
 * Detection is deliberately conservative and documented as heuristic:
 * a 9-digit BSN pattern and an IBAN pattern. Matched values must not be
 * stored, logged or submitted unnecessarily.
 */

const BSN_PATTERN = /\b\d{9}\b/;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,26}\b/;

/** Returns true when the text plausibly contains a BSN or IBAN. */
export function containsSensitiveValue(text: string): boolean {
  return BSN_PATTERN.test(text) || IBAN_PATTERN.test(text);
}

/** Patterns used by tests to verify sensitive values stay out of logs. */
export const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [BSN_PATTERN, IBAN_PATTERN];
