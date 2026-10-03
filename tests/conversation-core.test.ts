import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../src/domain/conversation-context';
import { createConversationContext, getFact } from '../src/domain/conversation-context';
import { processEmployeeMessage } from '../src/domain/conversation-core';

function newContext(): ConversationContext {
  return createConversationContext('session-test', '2026-10-03T12:00:00.000Z');
}

/** The engine owns the logical turn counter; tests simulate its increment. */
function turn(context: ConversationContext, input: string) {
  context.currentTurn += 1;
  return turn(context, input);
}

describe('Conversation Core determinism and state authority', () => {
  it('produces identical results for identical input, context, catalogue and rules', () => {
    const input = 'hoi elvie mn outlook doet t sinds vanochtend niet op laptop';
    const results: string[] = [];
    const factSnapshots: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const context = newContext();
      const result = turn(context, input);
      results.push(JSON.stringify(result));
      factSnapshots.push(JSON.stringify(context.facts));
    }
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    expect(factSnapshots[0]).toBe(factSnapshots[1]);
    expect(factSnapshots[1]).toBe(factSnapshots[2]);
  });

  it('never changes the authoritative conversation state', () => {
    const context = newContext();
    turn(context, 'Mijn Outlook doet het niet.');
    expect(context.currentState).toBe('START');
  });
});

describe('Corpus A: incidents', () => {
  it('understands "Mijn Outlook doet het niet." deterministically and asks for the device', () => {
    const context = newContext();
    const { decision, classification } = turn(context, 'Mijn Outlook doet het niet.');
    expect(classification.value).toBe('incident');
    expect(classification.confidence).toBe('high');
    expect(classification.evidence.length).toBeGreaterThan(0);
    expect(decision.kind).toBe('missing_information');
    if (decision.kind === 'missing_information') {
      expect(decision.nextQuestion.category).toBe('device');
    }
    expect(getFact(context, 'serviceOrApplication')).toMatchObject({ value: 'Outlook', kind: 'explicit' });
    expect(getFact(context, 'symptom')).toMatchObject({
      value: 'not_working',
      kind: 'derived',
      sourceRuleId: 'symptom_not_working',
    });
  });

  it('understands "De printer doet het niet." without requiring an application', () => {
    const context = newContext();
    const { decision } = turn(context, 'De printer doet het niet.');
    expect(decision.kind).toBe('sufficient_understanding');
    expect(getFact(context, 'device')).toMatchObject({ value: 'printer', kind: 'explicit' });
    expect(getFact(context, 'serviceOrApplication')).toBeUndefined();
    // Unknown facts are not invented:
    expect(getFact(context, 'startTime')).toBeUndefined();
    expect(getFact(context, 'location')).toBeUndefined();
    expect(getFact(context, 'impact')).toBeUndefined();
    expect(getFact(context, 'requestedResource')).toBeUndefined();
  });

  it('understands the wifi laptop sentence without asking for the known device', () => {
    const context = newContext();
    const input = 'Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.';
    const { decision } = turn(context, input);
    expect(decision.kind).toBe('sufficient_understanding');
    if (decision.kind === 'missing_information') {
      throw new Error('known device must never be requested again');
    }
    expect(getFact(context, 'device')).toMatchObject({ value: 'laptop' });
    expect(getFact(context, 'symptom')).toMatchObject({ value: 'no_connection', kind: 'derived' });
    expect(getFact(context, 'startTime')).toMatchObject({ value: 'sinds vanochtend', kind: 'explicit' });
    expect(getFact(context, 'location')).toMatchObject({ value: 'op kantoor', kind: 'explicit' });
  });

  it('does not identify Teams as the broken application in "Outlook werkt niet maar Teams wel."', () => {
    const context = newContext();
    const { decision } = turn(context, 'Outlook werkt niet maar Teams wel.');
    expect(getFact(context, 'serviceOrApplication')?.value).toBe('Outlook');
    expect(JSON.stringify(context.facts)).not.toContain('"Teams"');
    expect(decision.kind).toBe('missing_information');
    if (decision.kind === 'missing_information') {
      expect(decision.nextQuestion.category).toBe('device');
    }
  });

  it('understands "Mijn laptop doet raar." without requiring an application', () => {
    const context = newContext();
    const { decision } = turn(context, 'Mijn laptop doet raar.');
    expect(decision.kind).toBe('sufficient_understanding');
    expect(getFact(context, 'symptom')).toMatchObject({ value: 'erratic_behavior', sourceRuleId: 'symptom_erratic' });
  });
});

describe('Corpus B: requests', () => {
  it('understands "Ik wil een nieuwe muis." as a request for a mouse', () => {
    const context = newContext();
    const { decision, classification } = turn(context, 'Ik wil een nieuwe muis.');
    expect(classification.value).toBe('request');
    expect(decision.kind).toBe('sufficient_understanding');
    expect(getFact(context, 'requestedResource')).toMatchObject({ value: 'muis', kind: 'explicit' });
  });

  it('understands a fictional shared mailbox access request', () => {
    const context = newContext();
    const input = 'Kan ik toegang krijgen tot de gedeelde mailbox Financiën?';
    const { decision, classification } = turn(context, input);
    expect(classification.value).toBe('request');
    expect(decision.kind).toBe('sufficient_understanding');
    expect(getFact(context, 'requestedResource')).toMatchObject({ value: 'Mailbox', kind: 'explicit' });
  });

  it('asks for the requested resource when the target is unknown', () => {
    const context = newContext();
    const { decision } = turn(context, 'Ik wil graag software laten installeren.');
    expect(decision.kind).toBe('missing_information');
    if (decision.kind === 'missing_information') {
      expect(decision.nextQuestion.category).toBe('requestedResource');
    }
    expect(getFact(context, 'requestedResource')).toBeUndefined();
  });
});

describe('Corpus C: security / phishing', () => {
  it('classifies "Ik heb een verdachte mail gekregen." as phishing with one indicator', () => {
    const context = newContext();
    const { decision, classification } = turn(context, 'Ik heb een verdachte mail gekregen.');
    expect(classification.value).toBe('phishing');
    expect(classification.confidence).toBe('medium');
    expect(decision.kind).toBe('security_sensitive_route');
    if (decision.kind === 'security_sensitive_route') {
      expect(decision.indicators).toEqual(['suspicious_message_received']);
    }
    // Phishing reports must not pollute service context with subject facts.
    expect(getFact(context, 'serviceOrApplication')).toBeUndefined();
  });

  it('extracts both indicators for a suspicious link in a strange mail', () => {
    const context = newContext();
    const input = 'Ik heb op een link in een vreemde mail geklikt.';
    const { decision } = turn(context, input);
    expect(decision.kind).toBe('security_sensitive_route');
    if (decision.kind === 'security_sensitive_route') {
      expect(decision.indicators).toEqual(['suspicious_message_received', 'suspicious_link_clicked']);
    }
  });

  it('extracts link-click plus credential indicators conservatively', () => {
    const context = newContext();
    const input = 'Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.';
    const { decision, classification } = turn(context, input);
    expect(classification.value).toBe('phishing');
    expect(classification.confidence).toBe('high');
    expect(decision.kind).toBe('security_sensitive_route');
    if (decision.kind === 'security_sensitive_route') {
      expect(decision.indicators).toEqual(['suspicious_link_clicked', 'credentials_entered_after_suspicious_link']);
    }
  });

  it('classifies "Volgens mij is mijn account gehackt." as suspected compromise', () => {
    const context = newContext();
    const { decision } = turn(context, 'Volgens mij is mijn account gehackt.');
    expect(decision.kind).toBe('security_sensitive_route');
    if (decision.kind === 'security_sensitive_route') {
      expect(decision.indicators).toEqual(['suspected_account_compromise']);
    }
  });

  it('does not turn an availability problem into phishing merely because mail is involved', () => {
    const context = newContext();
    const { decision, classification } = turn(context, 'Mijn mail werkt niet.');
    expect(classification.value).toBe('incident');
    expect(decision.kind).not.toBe('security_sensitive_route');
  });
});

describe('Corpus D: unknown / ambiguous', () => {
  it('keeps "Kun je me helpen?" safely unknown', () => {
    const context = newContext();
    const { decision, classification } = turn(context, 'Kun je me helpen?');
    expect(classification.value).toBe('unknown');
    expect(classification.confidence).toBe('low');
    expect(decision.kind).toBe('unknown_understanding');
  });

  it('keeps a symptom without any subject safely unknown ("Het werkt niet.")', () => {
    const context = newContext();
    const { decision, classification } = turn(context, 'Het werkt niet.');
    expect(classification.value).toBe('unknown');
    expect(classification.confidence).toBe('low');
    expect(decision.kind).toBe('unknown_understanding');
  });

  it('keeps "Ik heb een vraag." safely unknown without inventing facts', () => {
    const context = newContext();
    const { decision } = turn(context, 'Ik heb een vraag.');
    expect(decision.kind).toBe('unknown_understanding');
    expect(context.facts).toEqual({});
  });
});

describe('Corpus E: informal input', () => {
  it('processes informal Dutch input deterministically', () => {
    const context = newContext();
    const input = 'hoi elvie mn outlook doet t sinds vanochtend niet op laptop';
    const { decision, classification } = turn(context, input);
    expect(classification.value).toBe('incident');
    expect(classification.confidence).toBe('high');
    expect(decision.kind).toBe('sufficient_understanding');
    expect(getFact(context, 'serviceOrApplication')).toMatchObject({ value: 'Outlook' });
    expect(getFact(context, 'device')).toMatchObject({ value: 'laptop' });
    expect(getFact(context, 'symptom')).toMatchObject({ value: 'not_working' });
    expect(getFact(context, 'startTime')).toMatchObject({ value: 'sinds vanochtend' });
  });
});

describe('Corpus F: corrections', () => {
  it('applies an explicit correction with markers and records the marker evidence', () => {
    const context = newContext();
    turn(context, 'Outlook werkt niet op mijn laptop.');
    expect(getFact(context, 'device')?.value).toBe('laptop');
    turn(context, 'Sorry, het is trouwens op mijn telefoon.');
    const device = getFact(context, 'device');
    expect(device).toMatchObject({ value: 'telefoon', kind: 'explicit', capturedAtTurn: 2 });
    expect(device?.evidence).toContain('correction_marker');
  });

  it('applies a later explicit correction WITHOUT requiring sorry/trouwens/ik bedoel', () => {
    const context = newContext();
    turn(context, 'Outlook werkt niet op mijn laptop.');
    turn(context, 'Het is op mijn telefoon.');
    const device = getFact(context, 'device');
    expect(device).toMatchObject({ value: 'telefoon', kind: 'explicit', capturedAtTurn: 2 });
    expect(device?.evidence).not.toContain('correction_marker');
  });

  it('replaces an earlier explicit device on the spec example without any intent yet', () => {
    const context = newContext();
    const first = turn(context, 'Het probleem is op mijn laptop.');
    expect(first.decision.kind).toBe('unknown_understanding');
    expect(getFact(context, 'device')?.value).toBe('laptop');
    turn(context, 'Het is op mijn telefoon.');
    expect(getFact(context, 'device')).toMatchObject({ value: 'telefoon', kind: 'explicit', capturedAtTurn: 2 });
  });
});

describe('Corpus G: ambiguity and clarification', () => {
  it('requests clarification for a multi-device answer when one device is required', () => {
    const context = newContext();
    const first = turn(context, 'Mijn Outlook doet het niet.');
    expect(first.decision.kind).toBe('missing_information');
    const second = turn(context, 'Het probleem speelt op mijn laptop en telefoon.');
    expect(second.decision.kind).toBe('clarification_required');
    if (second.decision.kind === 'clarification_required') {
      expect(second.decision.fact).toBe('device');
      expect(second.decision.reason).toBe('multiple_values_supplied');
    }
    // Ambiguous input never silently sets a fact:
    expect(getFact(context, 'device')).toBeUndefined();
  });

  it('does not request clarification when the ambiguous category is not required', () => {
    const context = newContext();
    const first = turn(context, 'De printer doet het niet.');
    expect(first.decision.kind).toBe('sufficient_understanding');
    const second = turn(context, 'Het probleem speelt op mijn laptop en telefoon.');
    expect(second.decision.kind).toBe('sufficient_understanding');
  });
});

describe('never knowingly ask twice (core level)', () => {
  it('stops asking for the device as soon as it is known', () => {
    const context = newContext();
    const first = turn(context, 'Mijn Outlook doet het niet.');
    expect(first.decision.kind).toBe('missing_information');
    const second = turn(context, 'Op mijn laptop.');
    expect(second.decision.kind).toBe('sufficient_understanding');
    expect(getFact(context, 'device')).toMatchObject({ value: 'laptop', kind: 'explicit', capturedAtTurn: 2 });
  });
});
