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

describe('ConversationEngine — BUILD 04C preview and corrections (§7.2, P-01..P-12)', () => {
  it('renders the preview from the validated snapshot and submits only after exact confirmation (P-01/P-10/P-13)', async () => {
    const ticket = new MockTicketProvider();
    const engine = createEngine(ticket);
    const preview = await driveToPreview(engine);
    expect(engine.currentState).toBe('PREVIEW');
    expect(preview).toContain('Categorie: melding');
    expect(preview).toContain('Functionele route: workplace');
    expect(preview).toContain('SIMULATIE');
    expect(preview).toContain('niets naar TOPdesk verzonden');

    const submitted = await engine.handleEmployeeInput('bevestigen');
    expect(text(submitted)).toContain('simulatie');
    expect(text(submitted)).toContain('SIM-');
    expect(engine.currentState).toBe('CONFIRM');
    expect(ticket.submitCallCount).toBe(1);

    // The submitted draft is EXACTLY the confirmed snapshot content.
    const snapshot = engine.currentPreviewSnapshot;
    const draft = ticket.submittedDrafts[0];
    expect(snapshot).not.toBeNull();
    expect(draft.summary).toBe(snapshot?.content.summary);
    expect(draft.description).toBe(snapshot?.content.description);
    expect(draft.context['onderwerp']).toBe(snapshot?.content.context['onderwerp']);
    expect(draft.context['apparaat']).toBe(snapshot?.content.context['apparaat']);
    expect(draft.context['symptoom']).toBe(snapshot?.content.context['symptoom']);
    expect(draft.category).toBe(snapshot?.content.category);
  });

  it('a material correction bumps the revision once, invalidates the snapshot and blocks a stale confirmation (P-03/P-07)', async () => {
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

    // A stale confirmation never submits: a fresh preview is shown.
    const stale = await engine.handleEmployeeInput('bevestigen');
    expect(text(stale)).toContain('Categorie:');
    expect(ticket.submitCallCount).toBe(0);

    // The fresh snapshot is confirmable with a new explicit confirmation.
    const submitted = await engine.handleEmployeeInput('versturen');
    expect(text(submitted)).toContain('SIM-');
    expect(ticket.submitCallCount).toBe(1);
    expect(ticket.submittedDrafts[0].context['apparaat']).toBe('desktop');
  });

  it('never submits "ja" during a correction flow and never asks twice (F-10/I-03, P-09)', async () => {
    const ticket = new MockTicketProvider();
    const engine = createEngine(ticket);
    await driveToPreview(engine);
    // Correction that makes the device field unresolved again.
    const corrected = await engine.handleEmployeeInput('ik heb eigenlijk geen idee welk apparaat het is');
    // Whether this revalidates directly or asks one bounded follow-up, no
    // submission may happen and exact confirmation words are never a submit
    // while the correction is open.
    expect(ticket.submitCallCount).toBe(0);
    expect(text(corrected)).not.toContain('SIM-');
    const again = await engine.handleEmployeeInput('ja');
    expect(ticket.submitCallCount).toBe(0);
    expect(text(again)).not.toContain('SIM-');
    expect(engine.currentState).toBe('PREVIEW');
  });

  it('shows accepted unknowns safely in the preview and blocks confirmation while essential info is missing (I-04/I-06/I-15/P-08)', async () => {
    const ticket = new MockTicketProvider();
    const engine = createEngine(ticket);
    await driveToPreview(engine);
    const corrected = await engine.handleEmployeeInput('het apparaat weet ik niet');
    expect(ticket.submitCallCount).toBe(0);
    const validation = engine.currentIntakeValidation;
    if (validation !== null && validation.outcome === 'needs_information') {
      expect(text(corrected)).toContain('niet volledig gevalideerd');
      const blocked = await engine.handleEmployeeInput('bevestigen');
      expect(ticket.submitCallCount).toBe(0);
      expect(text(blocked)).not.toContain('SIM-');
      expect(engine.currentState).toBe('PREVIEW');
    }
  });

  it('keeps the security path leading and confirmable as a simulation (F-06)', async () => {
    const ticket = new MockTicketProvider();
    const engine = createEngine(ticket);
    await engine.start();
    await engine.handleEmployeeInput('Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.');
    expect(engine.currentState).toBe('INTAKE');
    const preview = await engine.handleEmployeeInput('klaar');
    expect(engine.currentState).toBe('PREVIEW');
    expect(text(preview)).toContain('Categorie: beveiligingsmelding');
    expect(text(preview)).toContain('SIMULATIE');
    const submitted = await engine.handleEmployeeInput('bevestigen');
    expect(text(submitted)).toContain('SIM-');
    expect(ticket.submitCallCount).toBe(1);
  });
});
