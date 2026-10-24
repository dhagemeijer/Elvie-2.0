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

describe('ConversationEngine — BUILD 04A remediation (§5.2, §15.3)', () => {
  it('shows the targeted routing question and honors its deterministic answer', async () => {
    const engine = createTestEngine();
    await engine.start();
    // The deterministic core asks for the missing device first; the routing
    // question is never asked on top of a core question (core has priority).
    const first = await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    expect(text(first)).toContain('Op welk apparaat');
    expect(text(first)).not.toContain("Antwoord met 'applicatie' of 'berichten'");

    const second = await engine.handleEmployeeInput('op mijn laptop');
    expect(text(second)).toContain("Antwoord met 'applicatie' of 'berichten'");
    expect(engine.currentState).toBe('UNDERSTAND');

    const third = await engine.handleEmployeeInput('applicatie');
    expect(text(third)).not.toContain("Antwoord met 'applicatie' of 'berichten'");
    expect(text(third)).toContain('opgelost');
    expect(engine.currentState).toBe('KNOWLEDGE_SEARCH');
    // The non-distinguishing answer spent the budget: safe unknown fallback.
    expect(engine.currentRouting).toMatchObject({
      status: 'unknown',
      reasonCode: 'clarification_budget_exhausted',
    });
  });

  it('bumps the server-owned material revision exactly once per material change (§15.3)', async () => {
    const engine = createTestEngine();
    await engine.start();
    expect(engine.currentMaterialRevision).toBe(0);
    // No material facts are derived from this message: no revision bump.
    await engine.handleEmployeeInput('Kun je me helpen?');
    expect(engine.currentMaterialRevision).toBe(0);
    // Intent and symptom are derived: exactly one bump for this turn.
    await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    expect(engine.currentMaterialRevision).toBe(1);
    // Repeating the same complaint adds nothing material (administrative
    // refresh only): the revision stays unchanged.
    await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    expect(engine.currentMaterialRevision).toBe(1);
    // The device answer is a material change: one bump.
    await engine.handleEmployeeInput('op mijn laptop');
    expect(engine.currentMaterialRevision).toBe(2);
    // The routing answer adds no material fact: no bump.
    await engine.handleEmployeeInput('applicatie');
    expect(engine.currentMaterialRevision).toBe(2);
  });

  it('re-allows exactly one new routing question after a material revision bump', async () => {
    const engine = createTestEngine();
    await engine.start();
    await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    const second = await engine.handleEmployeeInput('op mijn laptop');
    expect(text(second)).toContain("Antwoord met 'applicatie' of 'berichten'");
    // A material correction of the subject bumps the revision and re-allows
    // exactly one new targeted question.
    const third = await engine.handleEmployeeInput('het is de gedeelde mailbox');
    expect(text(third)).toContain("Antwoord met 'applicatie' of 'berichten'");
    expect(engine.currentMaterialRevision).toBe(3);
    // The second answer spends the re-allowed budget: no further question.
    const fourth = await engine.handleEmployeeInput('berichten');
    expect(text(fourth)).not.toContain("Antwoord met 'applicatie' of 'berichten'");
    expect(text(fourth)).toContain('opgelost');
    expect(engine.currentRouting).toMatchObject({
      status: 'unknown',
      reasonCode: 'clarification_budget_exhausted',
    });
  });

  it('keeps security-first leading while a routing clarification is pending', async () => {
    const engine = createTestEngine();
    await engine.start();
    await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    await engine.handleEmployeeInput('op mijn laptop');
    // Routing question pending; a security report always wins immediately.
    const reply = await engine.handleEmployeeInput(
      'Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.',
    );
    expect(engine.currentState).toBe('INTAKE');
    expect(engine.currentRouting).toMatchObject({ status: 'determined', route: 'security' });
    expect(text(reply)).not.toContain("Antwoord met 'applicatie' of 'berichten'");
    expect(text(reply)).toContain('niet registreren of versturen');
  });
});

describe('ConversationEngine — BUILD 04A §15.3 final remediation', () => {
  it('serialises two concurrent employee messages within one session', async () => {
    const engine = createTestEngine();
    await engine.start();
    // Two messages submitted concurrently (same session) are processed
    // completely serially: context mutations, revision determination and
    // routing decisions can never interleave.
    const [first, second] = await Promise.all([
      engine.handleEmployeeInput('Mijn Outlook doet het niet.'),
      engine.handleEmployeeInput('op mijn laptop'),
    ]);
    // Arrival order: first the deterministic core's device question...
    expect(text(first)).toContain('Op welk apparaat');
    // ...then, with the device known, the ONE targeted routing question.
    expect(text(second)).toContain("Antwoord met 'applicatie' of 'berichten'");
    expect(engine.currentState).toBe('UNDERSTAND');
    // Exactly one revision bump per materially changed turn (2 turns).
    expect(engine.currentMaterialRevision).toBe(2);
  });

  it('keeps the clarification budget correctly spent after a non-informative answer', async () => {
    const engine = createTestEngine();
    await engine.start();
    await engine.handleEmployeeInput('Mijn Outlook doet het niet.');
    const question = await engine.handleEmployeeInput('op mijn laptop');
    expect(text(question)).toContain("Antwoord met 'applicatie' of 'berichten'");
    const revisionAtQuestion = engine.currentMaterialRevision;
    // The non-distinguishing answer adds no new material evidence:
    // no revision bump and no second routing question.
    const answer = await engine.handleEmployeeInput('applicatie');
    expect(engine.currentMaterialRevision).toBe(revisionAtQuestion);
    expect(text(answer)).not.toContain("Antwoord met 'applicatie' of 'berichten'");
    expect(text(answer)).toContain('opgelost');
    expect(engine.currentRouting).toMatchObject({
      status: 'unknown',
      reasonCode: 'clarification_budget_exhausted',
    });
  });
});
