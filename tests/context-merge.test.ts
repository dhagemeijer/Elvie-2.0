import { describe, expect, it } from 'vitest';
import { createConversationContext, getFact, setFactRecord } from '../src/domain/conversation-context';
import {
  CORRECTION_MARKERS,
  mergeExtractedFacts,
  mergeIntentClassification,
} from '../src/domain/context-merge';
import { extractFacts } from '../src/domain/fact-extraction';
import { classifyIntent } from '../src/domain/intent-classification';
import { normalizeInput } from '../src/domain/normalisation';
import {
  FICTIONAL_RECOGNITION_CATALOG,
  recognizeSubjects,
} from '../src/domain/recognition-catalog';

/** Apply one message through classification + extraction + merge at the given turn. */
function applyMessage(context: ReturnType<typeof createConversationContext>, raw: string, turn: number): void {
  context.currentTurn = turn;
  const normalized = normalizeInput(raw);
  const subjects = recognizeSubjects(normalized, FICTIONAL_RECOGNITION_CATALOG);
  const classification = classifyIntent(normalized, subjects);
  mergeIntentClassification(context, classification);
  const effectiveIntent = context.intentClassification?.value ?? classification.value;
  const extraction = extractFacts(normalized, FICTIONAL_RECOGNITION_CATALOG, context.currentTurn, effectiveIntent);
  mergeExtractedFacts(context, extraction, normalized);
}

describe('fact precedence and conflict resolution (BUILD_02.md par. 3)', () => {
  it('never lets a derived fact overwrite an explicit fact', () => {
    const context = createConversationContext('s1', '2026-10-03T12:00:00.000Z');
    setFactRecord(context, 'symptom', { value: 'volledige omschrijving van de medewerker', kind: 'explicit', capturedAtTurn: 1 });
    applyMessage(context, 'Mijn Outlook doet het niet.', 2);
    expect(getFact(context, 'symptom')).toEqual(
      expect.objectContaining({ value: 'volledige omschrijving van de medewerker', kind: 'explicit' }),
    );
  });

  it('replaces an earlier explicit value with a later unambiguous explicit value without any correction marker', () => {
    const context = createConversationContext('s1', '2026-10-03T12:00:00.000Z');
    applyMessage(context, 'Het probleem is op mijn laptop.', 1);
    expect(getFact(context, 'device')?.value).toBe('laptop');
    applyMessage(context, 'Het is op mijn telefoon.', 2);
    expect(getFact(context, 'device')).toEqual(
      expect.objectContaining({ value: 'telefoon', kind: 'explicit', capturedAtTurn: 2 }),
    );
  });

  it('also accepts the corpus correction with markers and records marker evidence', () => {
    const context = createConversationContext('s1', '2026-10-03T12:00:00.000Z');
    applyMessage(context, 'Outlook werkt niet op mijn laptop.', 1);
    applyMessage(context, 'Sorry, het is trouwens op mijn telefoon.', 2);
    const device = getFact(context, 'device');
    expect(device?.value).toBe('telefoon');
    expect(device?.evidence).toContain('correction_marker');
    expect(CORRECTION_MARKERS).toEqual(['sorry', 'trouwens', 'ik bedoel']);
  });

  it('refreshes the turn marker when the same value is supplied again', () => {
    const context = createConversationContext('s1', '2026-10-03T12:00:00.000Z');
    applyMessage(context, 'Outlook werkt niet op mijn laptop.', 1);
    applyMessage(context, 'Outlook werkt niet op mijn laptop.', 2);
    expect(getFact(context, 'device')).toEqual(
      expect.objectContaining({ value: 'laptop', capturedAtTurn: 2 }),
    );
  });

  it('never replaces a known fact with ambiguous multi-value input', () => {
    const context = createConversationContext('s1', '2026-10-03T12:00:00.000Z');
    applyMessage(context, 'Outlook werkt niet op mijn laptop.', 1);
    applyMessage(context, 'Het probleem speelt op mijn laptop en telefoon.', 2);
    expect(getFact(context, 'device')).toEqual(
      expect.objectContaining({ value: 'laptop', capturedAtTurn: 1 }),
    );
  });

  it('retains an established intent when a later message gives no confident alternative', () => {
    const context = createConversationContext('s1', '2026-10-03T12:00:00.000Z');
    applyMessage(context, 'Outlook werkt niet op mijn laptop.', 1);
    applyMessage(context, 'Het is op mijn telefoon.', 2);
    expect(context.intent).toBe('incident');
    expect(context.intentClassification?.value).toBe('incident');
  });

  it('replaces the intent when a later message produces a confident alternative', () => {
    const context = createConversationContext('s1', '2026-10-03T12:00:00.000Z');
    applyMessage(context, 'Outlook werkt niet op mijn laptop.', 1);
    applyMessage(context, 'Ik wil een nieuwe muis.', 2);
    expect(context.intent).toBe('request');
  });
});
