/**
 * ELVIE 2.0 — BUILD 04A — Server-owned material revision (§15.3).
 *
 * Central, deterministic comparison of the routing-relevant context before
 * and after an accepted turn: the revision rises exactly once per material
 * change and never for administrative bookkeeping alone. The revision is
 * owned by the conversation engine (one counter per session) and maintained
 * serially: every mutation path runs synchronously inside a single
 * handleEmployeeInput call, so the comparison cannot interleave.
 *
 * Routing clarification budgets couple to this revision (§15.3): at most
 * one targeted question per unchanged material situation; only a material
 * revision bump re-allows a question.
 */

/**
 * Deterministic revision step (§15.3): identical material states keep the
 * current revision; any material change raises it by exactly one. Pure and
 * total: identical inputs always produce an identical result.
 */
export function nextMaterialRevision(before: string, after: string, currentRevision: number): number {
  return before === after ? currentRevision : currentRevision + 1;
}
