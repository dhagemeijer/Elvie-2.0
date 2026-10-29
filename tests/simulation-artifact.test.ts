import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';

/**
 * BUILD 05.3 — artifact-level regression tests.
 *
 * Builds the REAL production and simulation bundles with Vite (simulated
 * Vercel system environment), then executes the built JavaScript in the DOM
 * on different hostnames. This proves the separation on the shipped
 * artifact, including the case where Vercel promotes a preview deployment to
 * production by REUSING the same build artifact (no rebuild): the simulation
 * artifact must then behave exactly like the fail-closed production build.
 */

const PRODUCTION_HOST = 'elvie-2-0.vercel.app';
const DEPLOYMENT_HOST = 'elvie-2-0-abc123-dhagemeijer.vercel.app';
const BRANCH_HOST = 'elvie-2-0-git-build-05-3-dhagemeijer.vercel.app';

const PREVIEW_ENV: Record<string, string> = {
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  ELVIE_SIMULATION: '1',
  VERCEL_URL: DEPLOYMENT_HOST,
  VERCEL_BRANCH_URL: BRANCH_HOST,
  VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
};
const PRODUCTION_ENV: Record<string, string> = {
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_URL: 'elvie-2-0-def456-dhagemeijer.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
};

const UNAVAILABLE = 'Elvie is op dit moment niet beschikbaar: de applicatie is niet volledig geconfigureerd.';
const MOCK_GREETING = 'Hallo Test Medewerker!';
const MOCK_MARKERS = /mock-employee-0001|Test Medewerker|InMemoryAuditLogger|MockTicketProvider/;

// Inside the project (not os.tmpdir()): the test runner only loads modules
// below the project root. node_modules/.cache is never committed.
const cacheDir = resolve(__dirname, '../node_modules/.cache');
mkdirSync(cacheDir, { recursive: true });
const workDir = mkdtempSync(join(cacheDir, 'elvie-artifact-'));
let runCounter = 0;

async function buildArtifact(mode: 'production' | 'simulation', env: Record<string, string>): Promise<string> {
  const outDir = join(workDir, mode);
  const keys = [...Object.keys(env), 'NODE_ENV'];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, env, { NODE_ENV: 'production' });
    await build({
      configFile: resolve(__dirname, '../vite.config.ts'),
      root: resolve(__dirname, '..'),
      mode,
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return outDir;
}

function bundleText(outDir: string): string {
  const assets = join(outDir, 'assets');
  return readdirSync(assets)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(assets, file), 'utf8'))
    .join('\n');
}

/** Serve the artifact on `hostname`: fresh copy (fresh module cache), fresh DOM. */
async function runArtifact(outDir: string, hostname: string): Promise<{ text: string; title: string }> {
  runCounter += 1;
  const copy = join(workDir, `run-${runCounter}`);
  cpSync(outDir, copy, { recursive: true });
  const entry = /src="\/(assets\/[^"]+\.js)"/.exec(readFileSync(join(copy, 'index.html'), 'utf8'))?.[1];
  if (entry === undefined) throw new Error('entry script not found in built index.html');

  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`https://${hostname}/`);
  document.title = 'Elvie — IT Servicebalie';
  document.body.innerHTML = '<div id="elvie"></div>';
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await import(/* @vite-ignore */ join(copy, entry));
    await vi.waitFor(
      () => {
        const text = document.body.textContent ?? '';
        if (!text.includes(UNAVAILABLE) && !text.includes(MOCK_GREETING)) throw new Error('engine not started yet');
      },
      { timeout: 5000 },
    );
  } finally {
    errors.mockRestore();
  }
  return { text: document.body.textContent ?? '', title: document.title };
}

let productionDir = '';
let simulationDir = '';

beforeAll(async () => {
  productionDir = await buildArtifact('production', PRODUCTION_ENV);
  simulationDir = await buildArtifact('simulation', PREVIEW_ENV);
}, 120_000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
  document.body.innerHTML = '';
});

describe('production artifact', () => {
  it('contains no mock composition and no simulation host allowlist', () => {
    const js = bundleText(productionDir);
    expect(js).not.toMatch(MOCK_MARKERS);
    expect(js).not.toContain(DEPLOYMENT_HOST);
    expect(readdirSync(join(productionDir, 'assets')).filter((f) => f.endsWith('.js'))).toHaveLength(1);
  });

  it.each([PRODUCTION_HOST, DEPLOYMENT_HOST])('stays fail-closed on %s', async (hostname) => {
    const { text, title } = await runArtifact(productionDir, hostname);
    expect(text).toContain(UNAVAILABLE);
    expect(text).not.toContain(MOCK_GREETING);
    expect(title).not.toContain('SIMULATIE');
  });
});

describe('simulation artifact', () => {
  it('bakes in exactly the preview hosts and never the production host', () => {
    const js = bundleText(simulationDir);
    expect(js).toContain(JSON.stringify([DEPLOYMENT_HOST, BRANCH_HOST]));
    expect(js).not.toContain(`"${PRODUCTION_HOST}"`);
  });

  it.each([DEPLOYMENT_HOST, BRANCH_HOST])(
    'runs the fictional mock composition, clearly marked as simulation, on %s',
    async (hostname) => {
      const { text, title } = await runArtifact(simulationDir, hostname);
      expect(text).toContain(MOCK_GREETING);
      expect(text).toContain('SIMULATIE — geen echte TOPdesk-registratie');
      expect(title).toBe('Elvie — SIMULATIE (fictieve gegevens)');
    },
  );

  it('REGRESSION promotion without rebuild: the same artifact on the production domain is fail-closed', async () => {
    const { text, title } = await runArtifact(simulationDir, PRODUCTION_HOST);
    expect(text).toContain(UNAVAILABLE);
    expect(text).not.toContain(MOCK_GREETING);
    expect(title).not.toContain('SIMULATIE');
  });

  it.each([
    'elvie.leidschendam-voorburg.nl',
    'elvie-2-0-other999-dhagemeijer.vercel.app',
    `${DEPLOYMENT_HOST}.evil.example`,
    'localhost',
  ])('the same artifact is fail-closed on any other host: %s', async (hostname) => {
    const { text } = await runArtifact(simulationDir, hostname);
    expect(text).toContain(UNAVAILABLE);
    expect(text).not.toContain(MOCK_GREETING);
  });
});

describe('build refusal', () => {
  it('a simulation build is refused for a Production deployment', async () => {
    await expect(buildArtifact('simulation', { ...PREVIEW_ENV, VERCEL_ENV: 'production' })).rejects.toThrow(
      /never/,
    );
  });
});
