/** Small shared helpers. No secrets, no configuration. */

/** Generate a unique identifier (session/correlation purposes). */
export function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Deterministic-enough fallback for environments without randomUUID.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Current ISO timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}
