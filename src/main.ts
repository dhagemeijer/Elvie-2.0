import './ui/elvie.css';
import { createChatShell } from './ui/chat-shell';
import { createProductionEngine } from './app/production-composition';
import { decideMockAccess } from './app/runtime-mode';

/**
 * Application entrypoint.
 *
 * Production wiring is fail-closed (see src/app/production-composition.ts).
 * The fictional mock composition exists only in two builds:
 * - the local dev server (`npm run dev`, import.meta.env.DEV);
 * - the explicit simulation build (`vite build --mode simulation`), which
 *   scripts/simulation-config.mjs only permits for an opted-in Vercel
 *   Preview (BUILD 05.3).
 * In every other build the condition below is statically false, so Rollup
 * prunes the mock module from the bundle. Keep the literal
 * import.meta.env comparisons here: they are what makes that pruning work.
 *
 * Inside a simulation artifact the mock composition is additionally gated on
 * an exact, build-time hostname allowlist. On any other host (e.g. the
 * production domain after a promotion reusing the artifact) the fail-closed
 * production composition is used. There is no silent mock fallback.
 */
async function boot(): Promise<void> {
  const root = document.getElementById('elvie');
  if (root === null) {
    throw new Error('Missing #elvie root element.');
  }
  if (import.meta.env.DEV || import.meta.env.MODE === 'simulation') {
    const access = decideMockAccess({
      dev: import.meta.env.DEV,
      hostname: window.location.hostname,
      allowedHosts: __ELVIE_SIMULATION_HOSTS__,
    });
    if (access === 'allowed') {
      const { createEngineWithMocks } = await import('./dev/dev-engine');
      if (!import.meta.env.DEV) {
        document.title = 'Elvie — SIMULATIE (fictieve gegevens)';
      }
      createChatShell(root, createEngineWithMocks().engine, {
        // BUILD 05: "Nieuw gesprek" starts a fresh engine session.
        createEngine: () => createEngineWithMocks().engine,
      });
      return;
    }
    // Refusal must be visible in dev tooling.
    console.error('Elvie simulation build refused on this host; using the fail-closed production composition.');
  }
  createChatShell(root, createProductionEngine(), {
    createEngine: () => createProductionEngine(),
  });
}

void boot().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- startup failure must be visible in dev tooling
  console.error('Elvie failed to start:', error);
});
