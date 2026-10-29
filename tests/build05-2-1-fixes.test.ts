import { describe, expect, it } from 'vitest';
import { ConversationEngine } from '../src/services/conversation-engine';
import { classifyIntent } from '../src/domain/intent-classification';
import { extractFacts } from '../src/domain/fact-extraction';
import { normalizeInput } from '../src/domain/normalisation';
import { FICTIONAL_RECOGNITION_CATALOG, recognizeSubjects } from '../src/domain/recognition-catalog';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import type { KnowledgePort, KnowledgeSearchQuery, KnowledgeSearchResponse } from '../src/ports/knowledge';

/**
 * BUILD 05.2.1 — regression for the link-click negation scope.
 *
 * normalizeInput strips sentence punctuation. The BUILD 05.2 negation
 * lookahead on the separated link-click variant therefore scanned the
 * remainder of the whole message, so any later "niet" (e.g. "ik weet niet
 * of dat erg is") suppressed a genuine click report, including the
 * credential-compromise composite. Before BUILD 05.2 these reports were
 * routed security-first; they must be again. Explicit denials stay
 * non-signals. All inputs are fictional.
 */

function classify(raw: string) {
  const normalized = normalizeInput(raw);
  return classifyIntent(normalized, recognizeSubjects(normalized, FICTIONAL_RECOGNITION_CATALOG));
}

function indicatorsOf(raw: string): string[] {
  const normalized = normalizeInput(raw);
  const extraction = extractFacts(normalized, FICTIONAL_RECOGNITION_CATALOG, 1, 'phishing');
  const value = extraction.facts.find((f) => f.category === 'securityIndicators')?.record.value;
  return value !== undefined ? value.split(', ') : [];
}

class FailClosedKnowledgePort implements KnowledgePort {
  calls = 0;
  search(_query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
    this.calls += 1;
    throw new Error('knowledge search must not run on the security route');
  }
}

const CLICK_WITH_LATER_NIET = [
  'Ik heb op een link in de mail geklikt en weet niet of dat erg is',
  'Ik heb op de link in de mail geklikt en weet niet of dat erg is',
  'Ik heb op de link uit die mail geklikt. Er gebeurde niets en nu werkt Outlook niet.',
  'Ik heb op het link in de vreemde mail geklikt; niet slim, denk ik.',
];

const CREDENTIALS_WITH_LATER_NIET =
  'Ik heb op een link in de mail geklikt en daar mijn wachtwoord ingevuld, ik weet niet of dat goed is';

const EXPLICIT_DENIALS = [
  'Ik heb niet op de link geklikt',
  'Ik heb nog niet op de link geklikt',
  'Ik heb op de link niet geklikt',
  'Ik heb op de link in de mail niet geklikt',
  'Ik heb op de link in de mail gelukkig niet geklikt en niets ingevuld',
];

describe('BUILD 05.2.1 — link-click negation is scoped to the words between link and click', () => {
  it.each(CLICK_WITH_LATER_NIET)('recognizes a click despite a later, unrelated "niet": %s', (input) => {
    const result = classify(input);
    expect(result.value).toBe('phishing');
    expect(result.confidence).toBe('high');
    expect(result.evidence.map((e) => e.ruleId)).toContain('sec_link_clicked');
    expect(indicatorsOf(input)).toContain('suspicious_link_clicked');
  });

  it('restores the credential-compromise composite when a later "niet" follows', () => {
    const result = classify(CREDENTIALS_WITH_LATER_NIET);
    expect(result.value).toBe('phishing');
    expect(result.evidence.map((e) => e.ruleId)).toContain('sec_credentials_composite');
    expect(indicatorsOf(CREDENTIALS_WITH_LATER_NIET)).toEqual(
      expect.arrayContaining(['suspicious_link_clicked', 'credentials_entered_after_suspicious_link']),
    );
  });

  it.each(EXPLICIT_DENIALS)('still never signals a click on an explicit denial: %s', (input) => {
    expect(classify(input).evidence.map((e) => e.ruleId)).not.toContain('sec_link_clicked');
    expect(indicatorsOf(input)).not.toContain('suspicious_link_clicked');
    expect(indicatorsOf(input)).not.toContain('credentials_entered_after_suspicious_link');
  });

  it('engine: routes the report security-first without knowledge search or secret requests', async () => {
    const knowledge = new FailClosedKnowledgePort();
    const engine = new ConversationEngine({
      identity: new MockIdentityProvider(),
      knowledge,
      ticket: new MockTicketProvider(),
      operational: { log: () => undefined },
      audit: new InMemoryAuditLogger(),
    });
    await engine.start();
    const reply = (await engine.handleEmployeeInput(CREDENTIALS_WITH_LATER_NIET)).map((m) => m.text).join('\n');
    expect(reply).not.toContain('Ik begrijp nog niet precies');
    expect(reply).toContain('beveiligingsmelding');
    expect(reply).not.toMatch(/vul je wachtwoord|je token|verificatiecode|pincode/i);
    expect(engine.currentState).toBe('INTAKE');
    expect(engine.currentPresentation.intakeType).toBe('security');
    expect(knowledge.calls).toBe(0);
  });
});
