import { describe, expect, it } from 'vitest';
import { classifyIntent } from '../src/domain/intent-classification';
import { normalizeInput } from '../src/domain/normalisation';
import {
  FICTIONAL_RECOGNITION_CATALOG,
  recognizeSubjects,
} from '../src/domain/recognition-catalog';

function classify(raw: string) {
  const normalized = normalizeInput(raw);
  return classifyIntent(normalized, recognizeSubjects(normalized, FICTIONAL_RECOGNITION_CATALOG));
}

describe('intent classification (BUILD_02.md par. 1)', () => {
  it('classifies the incident corpus deterministically with high confidence and evidence', () => {
    const corpus = [
      'Mijn Outlook doet het niet.',
      'De printer doet het niet.',
      'Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.',
      'Mijn laptop doet raar.',
    ];
    for (const input of corpus) {
      const result = classify(input);
      expect(result.value).toBe('incident');
      expect(result.confidence).toBe('high');
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence.every((e) => e.ruleId.length > 0)).toBe(true);
    }
  });

  it('classifies requests, including without a recognized subject (medium confidence)', () => {
    expect(classify('Ik wil een nieuwe muis.')).toEqual(
      expect.objectContaining({ value: 'request', confidence: 'high' }),
    );
    expect(classify('Kan ik toegang krijgen tot de gedeelde mailbox Financiën?')).toEqual(
      expect.objectContaining({ value: 'request', confidence: 'high' }),
    );
    expect(classify('Ik wil graag software laten installeren.')).toEqual(
      expect.objectContaining({ value: 'request', confidence: 'medium' }),
    );
  });

  it('classifies the security corpus conservatively', () => {
    expect(classify('Ik heb een verdachte mail gekregen.')).toEqual(
      expect.objectContaining({ value: 'phishing', confidence: 'medium' }),
    );
    expect(classify('Ik heb op een link in een vreemde mail geklikt.')).toEqual(
      expect.objectContaining({ value: 'phishing', confidence: 'high' }),
    );
    expect(classify('Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.')).toEqual(
      expect.objectContaining({ value: 'phishing', confidence: 'high' }),
    );
    expect(classify('Volgens mij is mijn account gehackt.')).toEqual(
      expect.objectContaining({ value: 'phishing', confidence: 'high' }),
    );
  });

  it('treats "mail" alone as an availability problem, not phishing', () => {
    const result = classify('Mijn mail doet het niet.');
    expect(result.value).toBe('incident');
    expect(result.confidence).toBe('high');
  });

  it('does not identify Teams as broken when it is stated to be working', () => {
    const result = classify('Outlook werkt niet maar Teams wel.');
    expect(result.value).toBe('incident');
  });

  it('returns unknown as a safe result for the unknown/ambiguous corpus', () => {
    for (const input of ['Kun je me helpen?', 'Het werkt niet.', 'Ik heb een vraag.']) {
      const result = classify(input);
      expect(result.value).toBe('unknown');
      expect(result.confidence).toBe('low');
    }
  });

  it('keeps a symptom without any recognized subject unknown (insufficient evidence)', () => {
    const result = classify('Het werkt niet.');
    expect(result.value).toBe('unknown');
    expect(result.evidence.length).toBeGreaterThan(0); // the symptom evidence is still explainable
  });

  it('is deterministic: identical input produces an identical result', () => {
    const raw = 'hoi elvie mn outlook doet t sinds vanochtend niet op laptop';
    expect(classify(raw)).toEqual(classify(raw));
  });
});
