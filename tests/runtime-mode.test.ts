import { describe, expect, it } from 'vitest';
import { decideMockAccess } from '../src/app/runtime-mode';

/**
 * BUILD 05.3 — runtime host gate (defence in depth). Exact hostname matching
 * against the allowlist baked into a simulation artifact.
 */

const ALLOWED = ['elvie-2-0-abc123-dhagemeijer.vercel.app', 'elvie-2-0-git-build-05-3-dhagemeijer.vercel.app'];

describe('decideMockAccess', () => {
  it.each(ALLOWED)('allows the exact baked-in preview host %s', (hostname) => {
    expect(decideMockAccess({ dev: false, hostname, allowedHosts: ALLOWED })).toBe('allowed');
  });

  it.each([
    'elvie-2-0.vercel.app', // production domain (promotion reusing the artifact)
    'elvie.leidschendam-voorburg.nl', // future custom production domain
    'elvie-2-0-other999-dhagemeijer.vercel.app', // another deployment of the project
    'evil-elvie-2-0-abc123-dhagemeijer.vercel.app',
    'elvie-2-0-abc123-dhagemeijer.vercel.app.evil.example',
    'x.elvie-2-0-abc123-dhagemeijer.vercel.app',
    'ELVIE-2-0-ABC123-DHAGEMEIJER.VERCEL.APP',
    'elvie-2-0-abc123-dhagemeijer.vercel.app.',
    'localhost',
    '',
  ])('refuses any other host: "%s"', (hostname) => {
    expect(decideMockAccess({ dev: false, hostname, allowedHosts: ALLOWED })).toBe('refused');
  });

  it('refuses everything when the artifact carries no allowlist', () => {
    expect(decideMockAccess({ dev: false, hostname: 'localhost', allowedHosts: [] })).toBe('refused');
    expect(decideMockAccess({ dev: false, hostname: ALLOWED[0] ?? '', allowedHosts: [] })).toBe('refused');
  });

  it('keeps the local dev server working (DEV is only true for `vite`, never for a guarded build)', () => {
    expect(decideMockAccess({ dev: true, hostname: 'localhost', allowedHosts: [] })).toBe('allowed');
  });
});
