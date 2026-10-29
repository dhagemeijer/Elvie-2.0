/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { elvieBuildDefines } from './scripts/simulation-config.mjs';

export default defineConfig(({ command, mode }) => ({
  // BUILD 05.3: validates the build environment and injects the exact
  // simulation host allowlist ([] for every non-simulation build).
  define: elvieBuildDefines({ command, mode }, process.env),
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
}));
