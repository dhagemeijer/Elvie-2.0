/**
 * BUILD 05.3 — runtime gate for the simulation (fictional mock) composition.
 *
 * This is DEFENCE IN DEPTH, not the primary boundary. The primary boundary
 * is build-time: a production build does not contain the mock composition at
 * all (see src/main.ts and scripts/simulation-config.mjs).
 *
 * A simulation artifact carries an exact allowlist of hostnames, baked in at
 * build time. The mock composition is only activated on one of those exact
 * hostnames. Everywhere else, notably the production domain after a
 * promotion that reuses the same artifact, the caller must use the
 * fail-closed production composition. No patterns, no suffix matching, no
 * case folding.
 */
export type MockAccess = 'allowed' | 'refused';

export interface MockAccessInput {
  /** import.meta.env.DEV: true only for the local Vite dev server. */
  readonly dev: boolean;
  /** window.location.hostname of the running page. */
  readonly hostname: string;
  /** Exact hostnames baked into the simulation artifact. */
  readonly allowedHosts: readonly string[];
}

export function decideMockAccess(input: MockAccessInput): MockAccess {
  if (input.dev) {
    return 'allowed';
  }
  if (input.hostname === '' || input.allowedHosts.length === 0) {
    return 'refused';
  }
  return input.allowedHosts.includes(input.hostname) ? 'allowed' : 'refused';
}
