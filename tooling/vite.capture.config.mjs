// ELVIE 2.0 — BASE-01 Route B — Vite bundling config (TEMPORARY, verification-only)
// Pinned baseline: 6a0ccb2f705decee6cb8c572ec14df26ad33c9c6 (tree 591faae3ea84fcb12f63c6fd4dd18848ee5319e1)
//
// WHY THIS WORKS WITH EXISTING DEPENDENCIES ONLY
// - The baseline already ships vite ^7.1.0 as a devDependency (package.json);
//   the workflow invokes `node baseline/node_modules/vite/bin/vite.js` directly,
//   so NO tooling is installed and nothing is added to the baseline workmap.
// - The entry `tooling/capture-fixtures.mjs` statically imports TypeScript
//   modules from `../baseline/src/**`. During `vite build`, module resolution
//   and TS transpilation are handled by esbuild, which is a built-in vite
//   dependency (no tsc, no tsconfig, no type-aware step is required for
//   bundling; typecheck is already covered by the separate quality gate
//   `npm run typecheck` in the baseline).
// - `root` is set to the workspace root (one level above `tooling/`) so that
//   both `tooling/` and `baseline/` live inside the vite root; relative
//   imports from the entry into `../baseline/src/**` then resolve normally.
// - The produced bundle (`tooling-dist/capture-bundle.mjs`) is fully
//   self-contained EXCEPT for node builtins (marked external): the baseline
//   source is inlined at build time. The baseline workmap is therefore NEVER
//   read at capture runtime and NEVER written by the bundler (outDir is
//   `tooling-dist`, outside `baseline/`).
//
// CORRECTION 2 (separated workmaps): tooling artifacts live in
// `tooling/` + `tooling-dist/`; application code stays untouched in `baseline/`.

import { fileURLToPath } from 'node:url';

// NOTE: this config is loaded by the vite CLI from the baseline node_modules
// (`node baseline/node_modules/vite/bin/vite.js build --config <this file>`),
// so vite itself is never imported here and no resolution ambiguity exists.

export default {
  root: fileURLToPath(new URL('..', import.meta.url)), // workspace root: contains tooling/ and baseline/
  build: {
    outDir: 'tooling-dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'node22',
    lib: {
      entry: fileURLToPath(new URL('./capture-fixtures.mjs', import.meta.url)),
      formats: ['es'],
      fileName: () => 'capture-bundle.mjs',
    },
    rollupOptions: {
      external: [/^node:/], // node builtins stay external
    },
  },
};
