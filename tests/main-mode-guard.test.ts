import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * BUILD 05.3 — source guard for src/main.ts. The tree-shaking that keeps the
 * mock composition out of the production bundle depends on the literal
 * import.meta.env condition; this test catches accidental weakening
 * (e.g. `!import.meta.env.PROD`, a runtime env lookup or a catch fallback).
 */
const source = readFileSync(resolve(__dirname, '../src/main.ts'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('src/main.ts composition guard', () => {
  it('imports the mock composition exactly once, dynamically', () => {
    expect(code.match(/dev\/dev-engine/g)).toHaveLength(1);
    expect(code).toMatch(/await import\('\.\/dev\/dev-engine'\)/);
    expect(code).not.toMatch(/^\s*import[^(]*dev\/dev-engine/m);
    expect(code).not.toMatch(/mocks\//);
  });

  it('gates the mock branch on the exact static build condition', () => {
    expect(code).toContain("if (import.meta.env.DEV || import.meta.env.MODE === 'simulation') {");
    expect(code).not.toMatch(/import\.meta\.env\.PROD/);
    expect(code).not.toMatch(/import\.meta\.env\.VITE_/);
  });

  it('gates the dynamic import on the runtime host decision', () => {
    const accessCheck = code.indexOf("if (access === 'allowed') {");
    const mockImport = code.indexOf("await import('./dev/dev-engine')");
    expect(accessCheck).toBeGreaterThan(-1);
    expect(mockImport).toBeGreaterThan(accessCheck);
    expect(code).toContain('allowedHosts: __ELVIE_SIMULATION_HOSTS__');
  });

  it('has no catch-based fallback to the mock composition', () => {
    expect(code).not.toMatch(/catch[\s\S]{0,200}createEngineWithMocks/);
  });
});
