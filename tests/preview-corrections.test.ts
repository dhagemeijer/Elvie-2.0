import { describe, expect, it } from 'vitest';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';

function createEngine(ticket: MockTicketProvider = new MockTicketProvider()): ConversationEngine {
  return new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    ticket,
    operational: consoleOperationalLogger(),
    audit: new InMemoryAuditLogger(),
  });
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((m) => m.text).join('\n');
}

async function driveToPreview(engine: ConversationEngine): Promise<string> {
  await engine.start();
  await engine.handleEmployeeInput('printer print niet');
  let reply = await engine.handleEmployeeInput('niet opgelost');
  let guard = 0;
  while (!text(reply).includes('Categorie:') && guard < 8) {
    reply = await engine.handleEmployeeInput('niet opgelost');
    guard += 1;
  }
  return text(reply);
}

describe('ConversationEngine — BUILD 04C preview and corrections (§7.2, P-01..P-13)', () => {
  it('renders the preview from the validated snapshot and submits only after exact confirmation (P-01/P-10/P-13)', async () => {
    const ticket = new MockTicketProvider();
    const engine = createEngine(ticket);
    const preview = await driveToPreview(engine);
    expect(engine.currentState).toBe('PREVIEW');
    expect(preview).toContain('Categorie: melding');
    // BUILD 05.1 (finding 03): plain B1 presentation, no internal route code.
    expect(preview).toContain('Soort probleem: Werkplek en apparatuur');
    expect(preview).toContain('simulatie');
    expect(preview).toContain('niets naar TOPdesk verzonden');

    const submitted = await engine.handleEmployeeInput('bevestigen');
    expect(text(submitted)).toContain('simulatie');
    expect(text(submitted)).toContain('SIM-');
    expect(engine.currentState).toBe('CONFIRM');
    expect(ticket.submitCallCount).toBe(1);

    // The submitted draft is EXACTLY the confirmed snapshot content.
    const snapshot = engine.currentPreviewSnapshot;
    const draft = ticket.submittedDrafts[0];
    const content = snapshot?.content;
    expect(snapshot).not.toBeNull();
    expect(draft).toBeDefined();
    expect(content).toBeDefined();
    if (draft === undefined || content === undefined) {
      throw new Error('submitted draft or snapshot content missing');
    }
    expect(draft.summary).toBe(content.summary);
    expect(draft.description).toBe(content.description);
    expect(draft.context['onderwerp']).toBe(content.context['onderwerp']);
    expect(draft.context['apparaat']).toBe(content.context['apparaat']);
    expect(draft.context['symptoom']).toBe(content.context['symptoom']);
    expect(draft.category).toBe(content.category);
  });

  it('a material correction bumps the revision once and the old snapshot can never submit (P-03/P-07/P-13)', async () => {
    const ticket = new MockTicketProvider();
    const engine = createEngine(ticket);
    await driveToPreview(engine);
    const revisionAtPreview = engine.currentMaterialRevision;
    const snapshotAtPreview = engine.currentPreviewSnapshot;

    const corrected = await engine.handleEmployeeInput('het is eigenlijk een desktop');
    expect(text(corrected)).toContain('bijgewerkte melding');
    expect(engine.currentMaterialRevision).toBe(revisionAtPreview + 1);
    // The old snapshot is superseded by the revision bump.
    expect(snapshotAtPreview?.revision).toBe(revisionAtPreview);
    expect(engine.currentPreviewSnapshot?.revision).toBe(revisionAtPreview + 1);
    expect(ticket.submitCallCount).toBe(0);

    // A confirmation can only ever submit the CURRENT validated snapshot
    // content: the stale snapshot content ('apparaat' unknown before the
    // correction) is unreachable.
    const submitted = await engine.handleEmployeeInput('bevestigen');
    expect(text(submitted)).toContain('SIM-');
    expect(ticket.submitCallCount).toBe(1);
    expect(ticket.submittedDrafts[0]?.context['apparaat']).toBe('desktop');
  });

  it('a correction without a material change never bumps the revision and never submits on its own (§15.3/P-09)', async () => {
    const ticket = new MockTicketProvider();
    const engine = createEngine(ticket);
    await driveToPreview(engine);
    const revision = engine.currentMaterialRevision;

    // Inert correction input: no new facts, no typed outcomes. This is the
    // administrative-refresh case: the material revision must not rise.
    const corrected = await engine.handleEmployeeInput('bedankt voor het overzicht');
    expect(text(corrected)).toContain('bijgewerkte melding');
    expect(engine.currentMaterialRevision).toBe(revision);
    expect(ticket.submitCallCount).toBe(0);
    expect(engine.currentState).toBe('PREVIEW');

    // The snapshot is still current and remains confirmable.
    const submitted = await engine.handleEmployeeInput('bevestigen');
    expect(ticket.submitCallCount).toBe(1);
    expect(text(submitted)).toContain('SIM-');
  });

  it('keeps the security path leading and confirmable as a simulation (F-06)', async () => {
    const ticket = new MockTicketProvider();
    const engine = createEngine(ticket);
    await engine.start();
    await engine.handleEmployeeInput('Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.');
    expect(engine.currentState).toBe('INTAKE');
    // F-06/I-10: the security intake never interrogates; 'klaar' hands over safely.
    const preview = await engine.handleEmployeeInput('klaar');
    expect(engine.currentState).toBe('PREVIEW');
    expect(text(preview)).toContain('Categorie: beveiligingsmelding');
    expect(text(preview)).toContain('simulatie');
    const submitted = await engine.handleEmployeeInput('bevestigen');
    expect(text(submitted)).toContain('SIM-');
    expect(ticket.submitCallCount).toBe(1);
  });
});
