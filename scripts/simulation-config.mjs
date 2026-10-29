/**
 * BUILD 05.3 — Vercel Preview simulation: build-time decision logic.
 *
 * This module is the PRIMARY separation between the fail-closed production
 * build and the fictional-mock simulation build. It runs only in Node
 * (vite.config.ts and scripts/vercel-build.mjs); nothing here is shipped to
 * the browser except the exact list of permitted simulation hostnames.
 *
 * Rules (all exact string comparisons, no case folding or trimming):
 * - Only two build modes exist: 'production' and 'simulation'.
 * - The simulation mode is selected ONLY when Vercel builds a Preview
 *   (VERCEL_ENV === 'preview') AND the explicit opt-in ELVIE_SIMULATION === '1'
 *   is present. Any other combination, including missing variables, selects
 *   the production mode (fail-closed engine). There is no mock fallback.
 * - ELVIE_SIMULATION present in a Production build is a misconfiguration and
 *   fails the build.
 * - A simulation build bakes in an EXACT allowlist of hostnames (this
 *   deployment's unique URL and its branch URL). The production hostname is
 *   never permitted. Because the allowlist is part of the artifact, the same
 *   artifact cannot run the mock composition on the production domain, even
 *   when Vercel reuses it on promotion (see src/app/runtime-mode.ts).
 * - A build with NODE_ENV other than 'production' is refused: it would set
 *   import.meta.env.DEV and include the mock composition without any gate.
 */

export const BUILD_MODES = Object.freeze(['production', 'simulation']);

/** Hostnames permitted for a simulation build made outside Vercel (local `vite preview`). */
export const LOCAL_SIMULATION_HOSTS = Object.freeze(['localhost', '127.0.0.1']);

/** A single DNS label directly under vercel.app, lowercase only. */
const VERCEL_PREVIEW_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;

export class SimulationConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SimulationConfigError';
  }
}

/** Decide the Vite build mode for a Vercel build. */
export function resolveBuildMode(env) {
  if (env.VERCEL_ENV === 'production' && env.ELVIE_SIMULATION !== undefined) {
    throw new SimulationConfigError(
      'ELVIE_SIMULATION must never be set for a Production deployment. Restrict the variable to the Preview environment.',
    );
  }
  return env.VERCEL_ENV === 'preview' && env.ELVIE_SIMULATION === '1' ? 'simulation' : 'production';
}

/** Refuse build environments that could produce an ungated mock bundle. */
export function assertSafeBuildEnvironment(env, mode) {
  if (!BUILD_MODES.includes(mode)) {
    throw new SimulationConfigError(`Unsupported build mode "${mode}". Allowed: ${BUILD_MODES.join(', ')}.`);
  }
  if (env.NODE_ENV !== undefined && env.NODE_ENV !== 'production') {
    throw new SimulationConfigError(
      `NODE_ENV="${env.NODE_ENV}" is not allowed for a build: it would enable the development composition without any gate.`,
    );
  }
  if (env.VERCEL_ENV === 'production' && env.ELVIE_SIMULATION !== undefined) {
    throw new SimulationConfigError('ELVIE_SIMULATION must never be set for a Production deployment.');
  }
  if (mode === 'simulation' && env.VERCEL_ENV === 'production') {
    throw new SimulationConfigError('A simulation build is never allowed for a Production deployment.');
  }
}

function requireVercelHost(name, value, productionHost) {
  if (value === undefined || value === '') {
    throw new SimulationConfigError(`${name} is required for a Vercel simulation build.`);
  }
  if (!VERCEL_PREVIEW_HOST.test(value)) {
    throw new SimulationConfigError(`${name}="${value}" is not a single-label *.vercel.app hostname.`);
  }
  if (value === productionHost) {
    throw new SimulationConfigError(`${name} equals the production hostname; refusing simulation build.`);
  }
  return value;
}

/**
 * Exact hostnames on which this simulation artifact may activate the mock
 * composition. Only called for mode === 'simulation'.
 */
export function resolveSimulationHosts(env) {
  const onVercel = env.VERCEL !== undefined || env.VERCEL_ENV !== undefined;
  if (!onVercel) {
    return [...LOCAL_SIMULATION_HOSTS];
  }
  if (env.VERCEL_ENV !== 'preview' || env.ELVIE_SIMULATION !== '1') {
    throw new SimulationConfigError(
      'A Vercel simulation build requires VERCEL_ENV="preview" and ELVIE_SIMULATION="1".',
    );
  }
  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionHost === undefined || productionHost === '') {
    throw new SimulationConfigError(
      'VERCEL_PROJECT_PRODUCTION_URL is required to prove the simulation hosts differ from production.',
    );
  }
  const hosts = [requireVercelHost('VERCEL_URL', env.VERCEL_URL, productionHost)];
  if (env.VERCEL_BRANCH_URL !== undefined && env.VERCEL_BRANCH_URL !== '') {
    hosts.push(requireVercelHost('VERCEL_BRANCH_URL', env.VERCEL_BRANCH_URL, productionHost));
  }
  return [...new Set(hosts)];
}

/** Vite `define` values for a given command/mode. Validates the environment for builds. */
export function elvieBuildDefines({ command, mode }, env) {
  let hosts = [];
  if (command === 'build') {
    assertSafeBuildEnvironment(env, mode);
    if (mode === 'simulation') {
      hosts = resolveSimulationHosts(env);
    }
  }
  return { __ELVIE_SIMULATION_HOSTS__: JSON.stringify(hosts) };
}
