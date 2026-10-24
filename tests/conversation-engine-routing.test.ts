import { describe, expect, it } from 'vitest';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';

function createTestEngine(): ConversationEngine {
  return new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    ticket: new MockTicketProvider(),
    operational: consoleOperationalLogger(),
    audit: new InMemoryAuditLogger(),
  });
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((message) => message.text).join('\n');
}

describe('ConversationEngine — Build 04A routing integration', () => {
  it('exposes no routing before any employee message is processed', async () => {
    const engine = createTestEngine();
    await engine.start();
    expect(engine.currentRouting).toBeNull();
  });

  it('computes the functional routing without changing the lifecycle (F-01)', async () => {
    const engine = createTestEngine();
    await engine.start();
    const reply = await engine.handleEmployeeInput('Ik kan niet inloggen op mijn account.');
    // Existing behavior is fully preserved: the engine proceeds through
    // the ordinary knowledge search; no routing content leaks into replies.
    expect(engine.currentState).toBe('KNOWLEDGE_SEARCH');
    expect(JSON.stringify(reply)).not.toContain('R-ACCESS-LOGIN');
    const routing = engine.currentRouting;
    expect(routing).toMatchObject({ status: 'determined', category: 'incident', route: 'access' });
  });

  it('keeps a security-sensitive case on the security path and bypasses knowledge search (R-06)', async () => {
    const engine = createTestEngine();
    await engine.start();
    // Fixture phrasing follows the approved Build 02 security catalog (sec_link_clicked).
    await engine.handleEmployeeInput('Ik heb op een link geklikt.');
    // Existing Build 03 behavior: knowledge search is bypassed, the
    // conversation goes straight to the specialized security intake.
    expect(engine.currentState).toBe('INTAKE');
    const routing = engine.currentRouting;
    expect(routing).toMatchObject({ status: 'determined', category: 'security', route: 'security' });
  });

  it('recomputes the routing after a correction in UNDERSTAND (F-08 flow)', async () => {
    const engine = createTestEngine();
    await engine.start();
    // The first message is materially ambiguous (application vs
    // communication) and asks for the device; the conversation stays in
    // UNDERSTAND, so the correction is processed by the same deterministic
    // core and the routing is recomputed on the corrected facts.
    await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    expect(engine.currentState).toBe('UNDERSTAND');
    expect(engine.currentRouting).toMatchObject({ status: 'clarification_required' });

    const reply = await engine.handleEmployeeInput(
      'Sorry, het is geen laptopprobleem, ik kan niet bij mijn account.',
    );
    expect(text(reply)).not.toContain('R-ACCESS-LOGIN');
    expect(engine.currentRouting).toMatchObject({ status: 'determined', route: 'access' });
  });

  it('never lets routing change the existing messages or transitions', async () => {
    const engine = createTestEngine();
    await engine.start();
    const search = await engine.handleEmployeeInput('printer print niet');
    expect(text(search)).toContain('Printer');
    // The routing is computed (workplace) but the resolution flow,
    // intake questions and preview texts are exactly the Build 03 ones.
    expect(engine.currentRouting).toMatchObject({ status: 'determined', route: 'workplace' });
    let intake = await engine.handleEmployeeInput('niet opgelost');
    let guard = 0;
    while (!text(intake).includes('Bevestig om de simulatie af te ronden') && guard < 4) {
      intake = await engine.handleEmployeeInput('niet opgelost');
      guard += 1;
    }
    expect(text(intake)).toContain('Bevestig om de simulatie af te ronden');
    expect(text(intake)).toContain('niets naar TOPdesk verzonden');
  });
});
