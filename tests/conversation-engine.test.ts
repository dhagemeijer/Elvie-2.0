import { describe, expect, it } from 'vitest';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';
import { unconfiguredIdentity } from '../src/ports/identity';

function createTestEngine(): {
  engine: ConversationEngine;
  audit: InMemoryAuditLogger;
  tickets: MockTicketProvider;
} {
  const audit = new InMemoryAuditLogger();
  const tickets = new MockTicketProvider();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    ticket: tickets,
    operational: consoleOperationalLogger(),
    audit,
  });
  return { engine, audit, tickets };
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((message) => message.text).join('\n');
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
    expect(text(search)).toContain('Wachtwoord');
    const resolved = await engine.handleEmployeeInput('ja');
    expect(text(resolved)).toContain('Fijn');
    expect(engine.currentState).toBe('DONE');
  });

  it('walks the intake path to a simulated ticket with a fictional reference', async () => {
    const { engine, audit, tickets } = createTestEngine();
    await engine.start();
    const search = await engine.handleEmployeeInput('printer print niet');
    expect(text(search)).toContain('Printer');
    const intake = await engine.handleEmployeeInput('niet opgelost');
    // No further articles: exhausted resolution routes to the generic
    // intake and, because everything is already known, straight to the preview.
    expect(text(intake)).toContain('versturen');
    const confirmed = await engine.handleEmployeeInput('versturen');
    expect(text(confirmed)).toMatch(/SIM-incident-\d{4}/);
    expect(text(confirmed)).toContain('simulatie');
    expect(tickets.submittedDrafts).toHaveLength(1);
    const submissionEvent = audit.recordedEvents.find((event) => event.action === 'submit_ticket');
    expect(submissionEvent?.outcome).toBe('success');
    expect(submissionEvent?.targetId).toMatch(/^SIM-incident-\d{4}$/);
  });

  it('blocks sensitive input server-side instead of storing or forwarding it', async () => {
    const { engine, tickets } = createTestEngine();
    await engine.start();
    await engine.handleEmployeeInput('printer print niet');
    await engine.handleEmployeeInput('niet opgelost');
    const warned = await engine.handleEmployeeInput('mijn BSN is 123456789 en het print niet');
    expect(text(warned)).toContain('gevoelige gegevens');
    // No ticket was submitted containing the sensitive value.
    expect(tickets.submittedDrafts).toHaveLength(0);
  });

  it('fails closed on start when identity is not configured', async () => {
    const audit = new InMemoryAuditLogger();
    const engine = new ConversationEngine({
      identity: unconfiguredIdentity(),
      knowledge: new MockKnowledgeProvider(),
      ticket: new MockTicketProvider(),
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
