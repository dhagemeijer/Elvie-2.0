import './ui/elvie.css';
import { createChatShell } from './ui/chat-shell';
import { createProductionEngine } from './app/production-composition';

/**
 * Application entrypoint.
 *
 * Production wiring is fail-closed (see src/app/production-composition.ts).
 * In dev mode (`npm run dev`) the fictional mock composition is loaded via a
 * dynamic import so the production build statically excludes it: with
 * import.meta.env.DEV === false the branch is dead code and Rollup prunes
 * the mock module from the bundle. There is no silent mock fallback.
 */
async function boot(): Promise<void> {
  const root = document.getElementById('elvie');
  if (root === null) {
    throw new Error('Missing #elvie root element.');
  }
  if (import.meta.env.DEV) {
    const { createEngineWithMocks } = await import('./dev/dev-engine');
    createChatShell(root, createEngineWithMocks().engine);
  } else {
    createChatShell(root, createProductionEngine());
  }
}

void boot().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- startup failure must be visible in dev tooling
  console.error('Elvie failed to start:', error);
});
