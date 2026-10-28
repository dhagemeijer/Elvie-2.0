import { describe, expect, it } from 'vitest';
import { ConversationEngine } from '../src/services/conversation-engine';
import { classifyIntent } from '../src/domain/intent-classification';
import { extractFacts } from '../src/domain/fact-extraction';
import { processEmployeeMessage } from '../src/domain/conversation-core';
import { createConversationContext, getFact } from '../src/domain/conversation-context';
import { normalizeInput } from '../src/domain/normalisation';
import {
  FICTIONAL_RECOGNITION_CATALOG,
  recognizeSubjects,
} from '../src/domain/recognition-catalog';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import type {
  KnowledgePort,
  KnowledgeSearchQuery,
  KnowledgeSearchResponse,
} from '../src/ports/knowledge';
import type { OperationalLogEntry, OperationalLoggerPort } from '../src/ports/logging';

/**
 * BUILD 05.2 — regression coverage for practical-test finding B05-T05:
 * security-first recognition of phishing with possible credential
 * compromise, without false positives on regular password questions,
 * general phishing questions or explicit denials.
 */

const PRACTICAL_INPUT =
  'Ik heb een verdachte e-mail ontvangen en op de link geklikt. Daarna heb ik mijn wachtwoord ingevuld. Wat moet ik doen?';

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

function newContext() {
  return createConversationContext('session-b05t05', '2026-10-28T12:00:00.000Z');
}

function turn(context: ReturnType<typeof newContext>, input: string) {
  context.currentTurn += 1;
  return processEmployeeMessage(context, input);
}

class RecordingLogger implements OperationalLoggerPort {
  readonly entries: OperationalLogEntry[] = [];
  log(entry: OperationalLogEntry): void {
    this.entries.push(entry);
  }
}

/** Knowledge port that must NEVER be consulted on the security route. */
class FailClosedKnowledgePort implements KnowledgePort {
  calls = 0;
  search(_query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
    this.calls += 1;
    throw new Error('knowledge search must not run on the security route');
  }
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((m) => m.text).join('\n');
}

describe('BUILD 05.2 — security-first recognition (finding B05-T05)', () => {
  it('A. recognizes the exact practical phishing report with high confidence and all signals', () => {
    const result = classify(PRACTICAL_INPUT);
    expect(result.value).toBe('phishing');
    expect(result.confidence).toBe('high');
    expect(result.evidence.map((e) => e.ruleId)).toEqual([
      'sec_suspicious_message',
      'sec_link_clicked',
      'sec_credentials_composite',
    ]);
    expect(indicatorsOf(PRACTICAL_INPUT)).toEqual([
      'suspicious_message_received',
      'suspicious_link_clicked',
      'credentials_entered_after_suspicious_link',
    ]);
    const context = newContext();
    const { decision } = turn(context, PRACTICAL_INPUT);
    expect(decision.kind).toBe('security_sensitive_route');
  });

  it('A/H (engine). routes the practical report through security-first end to end without secrets handling', async () => {
    const knowledge = new FailClosedKnowledgePort();
    const logger = new RecordingLogger();
    const audit = new InMemoryAuditLogger();
    const engine = new ConversationEngine({
      identity: new MockIdentityProvider(),
      knowledge,
      ticket: new MockTicketProvider(),
      operational: logger,
      audit,
    });
    await engine.start();
    const reply = text(await engine.handleEmployeeInput(PRACTICAL_INPUT));
    // Direct safe instructions + the existing security intake.
    expect(reply).toContain('simulatie');
    expect(reply).toContain('beveiligingsmelding');
    expect(reply).not.toContain('Ik begrijp nog niet precies');
    expect(engine.currentState).toBe('INTAKE');
    expect(engine.currentPresentation.intakeType).toBe('security');
    // Security-first interrupts the normal self-service flow: the
    // knowledge port is never consulted.
    expect(knowledge.calls).toBe(0);
    const preview = text(await engine.handleEmployeeInput('klaar'));
    expect(preview).toContain('Categorie: beveiligingsmelding');
    const submitted = text(await engine.handleEmployeeInput('bevestigen'));
    expect(submitted).toMatch(/SIM-security-\d{4}/);
    expect(submitted).toContain('geen echte TOPdesk-melding');

    // H. No secrets are requested, logged or unnecessarily processed.
    expect(reply).not.toMatch(/vul je wachtwoord|je token|verificatiecode|pincode/i);
    const logs = JSON.stringify(logger.entries);
    expect(logs).not.toContain('op de link geklikt');
    expect(logs).not.toContain('wachtwoord ingevuld');
    const auditBlob = JSON.stringify(audit.recordedEvents);
    expect(auditBlob).not.toContain('op de link geklikt');
    expect(auditBlob).not.toContain('wachtwoord ingevuld');
  });

  it('B. recognizes the alternative phrasing ("in phishing getrapt", "inloggegevens achtergelaten")', () => {
    const raw = 'Volgens mij ben ik in phishing getrapt en heb ik mijn inloggegevens achtergelaten.';
    expect(classify(raw).value).toBe('phishing');
    const indicators = indicatorsOf(raw);
    expect(indicators).toContain('suspicious_message_received');
    // No link click is described: the composite indicator stays absent.
    expect(indicators).not.toContain('credentials_entered_after_suspicious_link');
  });

  it('C. recognizes a suspicious attachment that was opened', () => {
    const raw = 'Ik heb een verdachte bijlage geopend uit een onbekende mail.';
    expect(classify(raw).value).toBe('phishing');
    expect(indicatorsOf(raw)).toEqual(['suspicious_attachment_opened']);
  });

  it('D. recognizes a possible account takeover', () => {
    const raw = 'Er is iemand anders ingelogd op mijn account.';
    expect(classify(raw).value).toBe('phishing');
    expect(indicatorsOf(raw)).toEqual(['suspected_account_compromise']);
  });

  it('E. keeps a regular password question ordinary IT support (no security route)', () => {
    const raw = 'Ik ben mijn wachtwoord vergeten en wil het opnieuw instellen.';
    expect(classify(raw).value).toBe('request');
    const context = newContext();
    const { decision } = turn(context, raw);
    expect(decision.kind).not.toBe('security_sensitive_route');
    expect(getFact(context, 'securityIndicators')).toBeUndefined();
  });

  it('F. keeps a general phishing question safely non-incident', () => {
    const raw = 'Hoe herken ik een phishingmail?';
    expect(classify(raw).value).toBe('unknown');
    const context = newContext();
    const { decision } = turn(context, raw);
    expect(decision.kind).toBe('unknown_understanding');
    expect(getFact(context, 'securityIndicators')).toBeUndefined();
  });

  it('G. never assumes stolen credentials on an explicit denial', () => {
    const raw =
      'Ik heb een verdachte mail ontvangen, maar niet op de link geklikt en geen gegevens ingevuld.';
    const result = classify(raw);
    expect(result.value).toBe('phishing');
    expect(result.confidence).toBe('medium');
    const indicators = indicatorsOf(raw);
    expect(indicators).toEqual(['suspicious_message_received']);
    expect(indicators).not.toContain('suspicious_link_clicked');
    expect(indicators).not.toContain('credentials_entered_after_suspicious_link');
  });

  it('I. existing flows do not regress (printer incident, request, existing phishing corpus)', () => {
    const printer = classify('Mijn printer werkt niet. Ik kan niets afdrukken.');
    expect(printer.value).toBe('incident');
    const request = classify('Ik wil een nieuwe laptop.');
    expect(request.value).toBe('request');
    const existing = classify('Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.');
    expect(existing.value).toBe('phishing');
    expect(existing.confidence).toBe('high');
  });

  it('is deterministic for the security corpus', () => {
    for (const raw of [PRACTICAL_INPUT, 'Er is iemand anders ingelogd op mijn account.']) {
      expect(classify(raw)).toEqual(classify(raw));
    }
  });
});
