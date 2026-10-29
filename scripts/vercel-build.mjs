/**
 * BUILD 05.3 — Vercel build entrypoint (vercel.json "buildCommand").
 *
 * Selects the Vite mode from Vercel's system environment and builds.
 * Anything other than an explicitly opted-in Preview builds the fail-closed
 * production bundle. vite.config.ts re-validates the environment, so a
 * build command override cannot bypass the checks.
 */
import { build } from 'vite';
import { resolveBuildMode } from './simulation-config.mjs';

const mode = resolveBuildMode(process.env);
console.log(`[elvie] Vercel build: VERCEL_ENV=${process.env.VERCEL_ENV ?? '(unset)'} → mode=${mode}`);
await build({ mode });
