import { describe, expect, it } from 'vitest';
import type { KnowledgeArticle } from '../src/ports/knowledge';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';

/**
 * BUILD 05.1 — regressions for the practical browser test findings:
 * - finding 01 (HIGH): knowledge relevance — a printer problem must never
 *   be offered the Outlook article on the shared symptom 'not_working';
 * - finding 03 (MEDIUM): plain B1 Dutch presentation of the preview,
 *   with the internal codes fully preserved in draft and audit.
 */

function printerArticle(id: string): KnowledgeArticle {
  return {
    id,
    title: 'Oplossing ' + id,
    summary: 'Fictieve printerinstructie.',
    steps: ['Stap 1', 'Stap 2'],
    sourceReference: 'KB-' + id.toUpperCase(),
    status: 'published',
    language: 'nl',
    minimumQualityMet: true,
    validFrom: '2024-01-01T00:00:00.000Z',
    keywords: ['printer'],
    subject: 'printer',
    symptom: 'not_working',
    authorizationDecision: { decidedBy: 'knowledge-adapter', decision: 'granted', policyId: 'policy-employee-kb' },
    audiencePolicy: { allowedAudiences: ['employee'] },
  };
}

function createEngine(
  knowledge: MockKnowledgeProvider,
): { engine: ConversationEngine; tickets: MockTicketProvider } {
  const tickets = new MockTicketProvider();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge,
    ticket: tickets,
    operational: consoleOperationalLogger(),
    audit: new InMemoryAuditLogger(),
  });
  return { engine, tickets };
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((message) => message.text).join('\n');
}

describe('BUILD 05.1 — knowledge relevance in the conversation flow (finding 01)', () => {
  it('a printer problem never gets the Outlook article; after rejection the intake follows', async () => {
    // The DEFAULT fictional catalogue contains the printer article
    // (mock-kb-003) and the Outlook article (mock-kb-004) sharing the
    // generic symptom 'not_working'.
    const { engine } = createEngine(new MockKnowledgeProvider());
    await engine.start();
    const first = text(
      await engine.handleEmployeeInput('Mijn printer werkt niet. Ik kan niets afdrukken.'),
    );
    expect(first).toContain('Printer komt niet gereed');
    expect(first).toContain('Lost dit je probleem op?');
    expect(engine.currentState).toBe('KNOWLEDGE_SEARCH');

    const second = text(await engine.handleEmployeeInput('niet opgelost'));
    // The Outlook article is NOT offered: no content relevance to a printer.
    expect(second).not.toContain('Outlook');
    // The existing intake continues deterministically to the preview.
    expect(second).toContain('vastleggen');
    expect(second).toContain('Categorie: melding');
  });

  it('a genuinely relevant second article is still offered (multiple relevant results)', async () => {
    const { engine } = createEngine(
      new MockKnowledgeProvider({ articles: [printerArticle('kb-p1'), printerArticle('kb-p2')] }),
    );
    await engine.start();
    const first = text(await engine.handleEmployeeInput('Mijn printer werkt niet. Ik kan niets afdrukken.'));
    expect(first).toContain('Oplossing kb-p1');
    const second = text(await engine.handleEmployeeInput('niet opgelost'));
    expect(second).toContain('Oplossing kb-p2');
    // Offered/rejected articles are never repeated.
    const third = text(await engine.handleEmployeeInput('helpt niet'));
    expect(third).not.toContain('Oplossing kb-p1');
    expect(third).not.toContain('Oplossing kb-p2');
    expect(third).toContain('vastleggen');
  });

  it('exhausted relevant knowledge continues safely to the intake without irrelevant leftovers', async () => {
    const { engine } = createEngine(new MockKnowledgeProvider({ articles: [printerArticle('kb-only')] }));
    await engine.start();
    await engine.handleEmployeeInput('Mijn printer werkt niet. Ik kan niets afdrukken.');
    const second = text(await engine.handleEmployeeInput('niet opgelost'));
    expect(second).toContain('vastleggen');
    expect(second).toContain('Categorie: melding');
  });
});

describe('BUILD 05.1 — plain Dutch preview presentation (finding 03)', () => {
  it('an incident preview shows B1 labels and preserves the internal codes in draft and audit', async () => {
    const { engine, tickets } = createEngine(new MockKnowledgeProvider({ articles: [] }));
    await engine.start();
    const reply = text(
      await engine.handleEmployeeInput('Mijn printer werkt niet. Ik kan niets afdrukken.'),
    );
    expect(reply).toContain('Categorie: melding');
    expect(reply).toContain('Soort probleem: Werkplek en apparatuur');
    expect(reply).toContain('Symptoom: Werkt niet (afgeleid uit je omschrijving)');
    // No raw internal enum values or programme codes in the interface.
    expect(reply).not.toContain('Functionele route');
    expect(reply).not.toContain('workplace');
    expect(reply).not.toContain('not_working');

    // Traceability: the submitted draft keeps the internal codes.
    const submitted = text(await engine.handleEmployeeInput('bevestigen'));
    expect(submitted).toMatch(/SIM-incident-\d{4}/);
    expect(tickets.submittedDrafts[0]?.context['symptoom']).toBe('not_working');
  });

  it('a request preview and a security preview use the same plain presentation', async () => {
    const request = createEngine(new MockKnowledgeProvider({ articles: [] }));
    await request.engine.start();
    const requestReply = text(await request.engine.handleEmployeeInput('Ik wil een nieuwe laptop.'));
    expect(requestReply).toContain('Categorie: aanvraag');
    expect(requestReply).toContain('Soort probleem:');

    const security = createEngine(new MockKnowledgeProvider({ articles: [] }));
    await security.engine.start();
    await security.engine.handleEmployeeInput('Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.');
    const preview = text(await security.engine.handleEmployeeInput('klaar'));
    expect(preview).toContain('Categorie: beveiligingsmelding');
    expect(preview).toContain('Soort probleem: Beveiliging');
  });
});
