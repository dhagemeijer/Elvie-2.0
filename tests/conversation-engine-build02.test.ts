import { describe, expect, it } from 'vitest';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockIncidentProvider } from '../src/mocks/mock-incident';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import type { OperationalLogEntry, OperationalLoggerPort } from '../src/ports/logging';

/** Test double that captures operational entries for safe-logging assertions. */
class CapturingOperationalLogger implements OperationalLoggerPort {
  readonly entries: OperationalLogEntry[] = [];
  log(entry: OperationalLogEntry): void {
    this.entries.push(entry);
  }
}

function createTestEngine(): {
  engine: ConversationEngine;
  operational: CapturingOperationalLogger;
  audit: InMemoryAuditLogger;
  incidents: MockIncidentProvider;
} {
  const operational = new CapturingOperationalLogger();
  const audit = new InMemoryAuditLogger();
  const incidents = new MockIncidentProvider();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    incidents,
    operational,
    audit,
  });
  return { engine, operational, audit, incidents };
}

describe('ConversationEngine Build 02 integration', () => {
  it('asks for the missing device once and proceeds when it is known (never ask twice)', async () => {
    const { engine } = createTestEngine();
    await engine.start();
    const first = await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    expect(first.some((m) => m.text.includes('Op welk apparaat'))).toBe(true);
    const second = await engine.handleEmployeeInput('op mijn laptop');
    expect(second.some((m) => m.text.includes('Op welk apparaat'))).toBe(false);
    // Sufficient understanding continues to the existing Build 01 flow:
    expect(second.some((m) => m.text.includes('geen instructies'))).toBe(true);
  });

  it('never asks for an already-known device (wifi laptop sentence)', async () => {
    const { engine } = createTestEngine();
    await engine.start();
    const reply = await engine.handleEmployeeInput(
      'Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.',
    );
    expect(reply.some((m) => m.text.includes('Op welk apparaat'))).toBe(false);
    expect(reply.some((m) => m.text.includes('geen instructies'))).toBe(true);
  });

  it('keeps unknown input in UNDERSTAND and recovers on the next message', async () => {
    const { engine } = createTestEngine();
    await engine.start();
    const unknown = await engine.handleEmployeeInput('Kun je me helpen?');
    expect(unknown.some((m) => m.text.includes('begrijp'))).toBe(true);
    const next = await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    expect(next.some((m) => m.text.includes('Op welk apparaat'))).toBe(true);
  });

  it('routes a phishing report conservatively and never submits an incident automatically', async () => {
    const { engine, audit, incidents } = createTestEngine();
    await engine.start();
    const reply = await engine.handleEmployeeInput(
      'Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.',
    );
    expect(reply.some((m) => m.text.includes('geen instructies'))).toBe(true);
    expect(incidents.submittedDrafts).toHaveLength(0);
    expect(audit.recordedEvents.some((event) => event.action === 'submit_incident')).toBe(false);
  });

  it('never logs raw employee input or sensitive values (safe logging)', async () => {
    const { engine, operational, audit } = createTestEngine();
    await engine.start();
    await engine.handleEmployeeInput('Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.');
    await engine.handleEmployeeInput('mijn BSN is 123456789 en het print niet');
    const allEmitted = JSON.stringify(operational.entries) + JSON.stringify(audit.recordedEvents);
    const lowered = allEmitted.toLowerCase();
    for (const fragment of ['wifi', 'kantoor', 'outlook', '123456789', 'wachtwoord ingevuld', 'geklikt']) {
      expect(lowered).not.toContain(fragment);
    }
    // The sensitive value was blocked with a safe warning:
    expect(operational.entries.some((entry) => entry.errorCategory === 'pii-guard')).toBe(true);
  });
});
