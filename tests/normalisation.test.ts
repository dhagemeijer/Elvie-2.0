import { describe, expect, it } from 'vitest';
import { CONTRACTION_MAP, normalizeInput, PHRASE_MAP } from '../src/domain/normalisation';

describe('input normalisation (BUILD_02.md par. 9)', () => {
  it('lowercases, strips simple punctuation and collapses whitespace', () => {
    expect(normalizeInput('  Mijn Outlook,   doet het niet!  ')).toBe('mijn outlook doet het niet');
  });

  it('is deterministic and idempotent', () => {
    const once = normalizeInput('Hoi Elvie! Mn Outlook doet t niet.');
    expect(normalizeInput(once)).toBe(once);
    expect(normalizeInput('Hoi Elvie! Mn Outlook doet t niet.')).toBe(once);
  });

  it('applies the approved contraction map word-bounded', () => {
    expect(normalizeInput('mn outlook doet het niet')).toBe('mijn outlook doet het niet');
    expect(Object.keys(CONTRACTION_MAP)).toEqual(['mn']);
  });

  it('applies the documented informal phrase variants', () => {
    expect(normalizeInput('outlook doet t niet')).toBe('outlook doet het niet');
    expect(normalizeInput('outlook werkt t niet')).toBe('outlook werkt het niet');
    expect(Object.keys(PHRASE_MAP)).toEqual(['doet t', 'werkt t']);
  });

  it('keeps hyphenated words like e-mail intact', () => {
    expect(normalizeInput('Mijn e-mail werkt niet.')).toBe('mijn e-mail werkt niet');
  });

  it('processes the informal corpus example deterministically', () => {
    expect(normalizeInput('hoi elvie mn outlook doet t sinds vanochtend niet op laptop')).toBe(
      'hoi elvie mijn outlook doet het sinds vanochtend niet op laptop',
    );
  });
});
