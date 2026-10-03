import { describe, expect, it } from 'vitest';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockIncidentProvider } from '../src/mocks/mock-incident';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';
import { unconfiguredIdentity } from '../src/ports/identity';

function createTestEngine(): { engine: ConversationEngine; audit: InMemoryAuditLogger; incidents: MockIncidentProvider } {
  const audit = new InMemoryAuditLogger();
  const incidents = new MockIncidentProvider();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    incidents,
    operational: consoleOperationalLogger(),
    audit,
  });
  return { engine, audit, incidents };
}

describe('ConversationEngine', () => {
  it('starts with a greeting after successful authentication', async () => {
    const { engine } = createTestEngine();
    const messages = await engine.start();
    expect(messages[0]?.role).toBe('elvie');
    expect(messages[0]?.text).toContain('Test Medewerker');
  });

  it('walks the resolve path when a knowledge item solves the issue', async () => {
    const { engine } = createTestEngine();
    await engine.start();
    const search = await engine.handleEmployeeInput('wachtwoord vergeten');
    expect(search.some((m) => m.text.includes('Wachtwoord vergeten'))).toBe(true);
    const resolved = await engine.handleEmployeeInput('ja');
    expect(resolved[resolved.length - 1]?.text).toContain('Fijn');
  });

  it('walks the intake path to a submitted incident with a fictional reference', async () => {
    const { engine, audit, incidents } = createTestEngine();
    await engine.start();
    await engine.handleEmployeeInput('printer print niet');
    await engine.handleEmployeeInput('nee');
    await engine.handleEmployeeInput('De printer op de tweede verdieping reageert niet.');
    await engine.handleEmployeeInput('Hoofdgebouw, tweede verdieping');
    const preview = await engine.handleEmployeeInput('nee nog even niet');
    expect(preview.some((m) => m.text.includes('versturen'))).toBe(true);
    const confirmed = await engine.handleEmployeeInput('versturen');
    expect(confirmed[confirmed.length - 1]?.text).toMatch(/MOCK-INCIDENT-\d{4}/);
    expect(incidents.submittedDrafts).toHaveLength(1);
    const submissionEvent = audit.recordedEvents.find((event) => event.action === 'submit_incident');
    expect(submissionEvent?.outcome).toBe('success');
    expect(submissionEvent?.targetId).toMatch(/^MOCK-INCIDENT-\d{4}$/);
  });

  it('blocks sensitive input server-side instead of storing or forwarding it', async () => {
    const { engine, incidents } = createTestEngine();
    await engine.start();
    await engine.handleEmployeeInput('printer print niet');
    await engine.handleEmployeeInput('nee');
    const warned = await engine.handleEmployeeInput('mijn BSN is 123456789 en het print niet');
    expect(warned.some((m) => m.text.includes('gevoelige gegevens'))).toBe(true);
    // No incident was submitted containing the sensitive value.
    expect(incidents.submittedDrafts).toHaveLength(0);
  });

  it('fails closed on start when identity is not configured', async () => {
    const { engine: _, audit, incidents } = createTestEngine();
    void _; void incidents;
    const engine = new ConversationEngine({
      identity: unconfiguredIdentity(),
      knowledge: new MockKnowledgeProvider(),
      incidents: new MockIncidentProvider(),
      operational: consoleOperationalLogger(),
      audit,
    });
    const messages = await engine.start();
    expect(messages[0]?.role).toBe('error');
    expect(messages[0]?.text).not.toContain('Test Medewerker');
    const authEvent = audit.recordedEvents.find((event) => event.action === 'establish_session');
    expect(authEvent?.outcome).toBe('failed');
    // A failed normal employee session must NOT be recorded as an
    // administrative event type; administrative event types are reserved
    // for genuine administrative access.
    expect(authEvent?.eventType).toBe('employee_session_establishment');
    expect(audit.recordedEvents.some((event) => event.eventType === 'administrative_authentication')).toBe(false);
    // No session exists: input cannot proceed.
    const reply = await engine.handleEmployeeInput('hallo');
    expect(reply[0]?.role).toBe('error');
  });
});
