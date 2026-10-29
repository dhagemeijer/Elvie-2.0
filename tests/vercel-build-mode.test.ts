import { describe, expect, it } from 'vitest';
import {
  SimulationConfigError,
  assertSafeBuildEnvironment,
  elvieBuildDefines,
  resolveBuildMode,
  resolveSimulationHosts,
} from '../scripts/simulation-config.mjs';

/**
 * BUILD 05.3 — build-time separation between Production and Preview
 * simulation. These rules are the primary boundary: a production build never
 * contains the mock composition.
 */

const PREVIEW_ENV = {
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  ELVIE_SIMULATION: '1',
  VERCEL_URL: 'elvie-2-0-abc123-dhagemeijer.vercel.app',
  VERCEL_BRANCH_URL: 'elvie-2-0-git-build-05-3-dhagemeijer.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: 'elvie-2-0.vercel.app',
} as const;

describe('resolveBuildMode', () => {
  it('selects simulation only for an opted-in Vercel Preview', () => {
    expect(resolveBuildMode({ VERCEL_ENV: 'preview', ELVIE_SIMULATION: '1' })).toBe('simulation');
  });

  it.each([
    ['no Vercel variables at all', {}],
    ['preview without opt-in', { VERCEL_ENV: 'preview' }],
    ['opt-in without VERCEL_ENV', { ELVIE_SIMULATION: '1' }],
    ['development environment with opt-in', { VERCEL_ENV: 'development', ELVIE_SIMULATION: '1' }],
    ['production without opt-in', { VERCEL_ENV: 'production' }],
  ])('falls back to the fail-closed production mode: %s', (_label, env) => {
    expect(resolveBuildMode(env)).toBe('production');
  });

  it.each([
    ['case variant of VERCEL_ENV', { VERCEL_ENV: 'Preview', ELVIE_SIMULATION: '1' }],
    ['padded VERCEL_ENV', { VERCEL_ENV: ' preview', ELVIE_SIMULATION: '1' }],
    ['opt-in "true"', { VERCEL_ENV: 'preview', ELVIE_SIMULATION: 'true' }],
    ['padded opt-in', { VERCEL_ENV: 'preview', ELVIE_SIMULATION: ' 1' }],
    ['empty opt-in', { VERCEL_ENV: 'preview', ELVIE_SIMULATION: '' }],
  ])('uses exact matching only, no loose truthiness: %s', (_label, env) => {
    expect(resolveBuildMode(env)).toBe('production');
  });

  it.each(['1', '0', '', 'false'])('fails the build when ELVIE_SIMULATION="%s" is present in Production', (value) => {
    expect(() => resolveBuildMode({ VERCEL_ENV: 'production', ELVIE_SIMULATION: value })).toThrow(
      SimulationConfigError,
    );
  });
});

describe('assertSafeBuildEnvironment', () => {
  it('accepts the plain production build used by CI and local `npm run build`', () => {
    expect(() => assertSafeBuildEnvironment({}, 'production')).not.toThrow();
    expect(() => assertSafeBuildEnvironment({ NODE_ENV: 'production' }, 'production')).not.toThrow();
  });

  it.each(['development', 'staging', 'preview', 'test'])('refuses unknown build mode "%s"', (mode) => {
    expect(() => assertSafeBuildEnvironment({}, mode)).toThrow(SimulationConfigError);
  });

  it.each(['development', 'test', ''])(
    'refuses NODE_ENV="%s": it would ship the ungated dev composition',
    (nodeEnv) => {
      expect(() => assertSafeBuildEnvironment({ NODE_ENV: nodeEnv }, 'production')).toThrow(SimulationConfigError);
    },
  );

  it('refuses a simulation build in a Production deployment even via a build command override', () => {
    expect(() => assertSafeBuildEnvironment({ VERCEL_ENV: 'production' }, 'simulation')).toThrow(
      SimulationConfigError,
    );
  });

  it('refuses ELVIE_SIMULATION in Production also for the production mode', () => {
    expect(() =>
      assertSafeBuildEnvironment({ VERCEL_ENV: 'production', ELVIE_SIMULATION: '1' }, 'production'),
    ).toThrow(SimulationConfigError);
  });
});

describe('resolveSimulationHosts', () => {
  it('bakes in exactly the deployment URL and branch URL of an opted-in Preview', () => {
    expect(resolveSimulationHosts(PREVIEW_ENV)).toEqual([
      'elvie-2-0-abc123-dhagemeijer.vercel.app',
      'elvie-2-0-git-build-05-3-dhagemeijer.vercel.app',
    ]);
  });

  it('never contains the production hostname', () => {
    expect(resolveSimulationHosts(PREVIEW_ENV)).not.toContain(PREVIEW_ENV.VERCEL_PROJECT_PRODUCTION_URL);
  });

  it('permits only localhost for a simulation build made outside Vercel', () => {
    expect(resolveSimulationHosts({})).toEqual(['localhost', '127.0.0.1']);
  });

  it.each([
    ['Production', { ...PREVIEW_ENV, VERCEL_ENV: 'production' }],
    ['Preview without opt-in', { ...PREVIEW_ENV, ELVIE_SIMULATION: undefined }],
    ['VERCEL_ENV missing while VERCEL=1', { ...PREVIEW_ENV, VERCEL_ENV: undefined }],
  ])('refuses a Vercel simulation build for %s', (_label, env) => {
    expect(() => resolveSimulationHosts(env)).toThrow(SimulationConfigError);
  });

  it.each([
    ['VERCEL_URL missing', { VERCEL_URL: undefined }],
    ['production URL missing', { VERCEL_PROJECT_PRODUCTION_URL: undefined }],
    ['VERCEL_URL equals production host', { VERCEL_URL: 'elvie-2-0.vercel.app' }],
    ['branch URL equals production host', { VERCEL_BRANCH_URL: 'elvie-2-0.vercel.app' }],
    ['custom domain', { VERCEL_URL: 'elvie.leidschendam-voorburg.nl' }],
    ['nested subdomain', { VERCEL_URL: 'a.elvie-2-0-abc.vercel.app' }],
    ['look-alike suffix', { VERCEL_URL: 'elvie-2-0-abc.vercel.app.evil.example' }],
    ['upper case', { VERCEL_URL: 'Elvie-2-0-abc.vercel.app' }],
    ['protocol included', { VERCEL_URL: 'https://elvie-2-0-abc.vercel.app' }],
    ['port included', { VERCEL_URL: 'elvie-2-0-abc.vercel.app:443' }],
  ])('fails the build on an invalid or unsafe host: %s', (_label, override) => {
    expect(() => resolveSimulationHosts({ ...PREVIEW_ENV, ...override })).toThrow(SimulationConfigError);
  });
});

describe('elvieBuildDefines', () => {
  it('injects an empty allowlist for the production build', () => {
    expect(elvieBuildDefines({ command: 'build', mode: 'production' }, PREVIEW_ENV)).toEqual({
      __ELVIE_SIMULATION_HOSTS__: '[]',
    });
  });

  it('injects an empty allowlist for the dev server and the test runner', () => {
    expect(elvieBuildDefines({ command: 'serve', mode: 'development' }, {})).toEqual({
      __ELVIE_SIMULATION_HOSTS__: '[]',
    });
  });

  it('injects the exact preview hosts for a simulation build', () => {
    const define = elvieBuildDefines({ command: 'build', mode: 'simulation' }, PREVIEW_ENV);
    expect(JSON.parse(define.__ELVIE_SIMULATION_HOSTS__)).toEqual([
      'elvie-2-0-abc123-dhagemeijer.vercel.app',
      'elvie-2-0-git-build-05-3-dhagemeijer.vercel.app',
    ]);
  });
});
