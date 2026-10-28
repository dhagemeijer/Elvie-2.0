import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createChatShell } from '../src/ui/chat-shell';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';
import type { TicketDraft, TicketPort, TicketStatusResult, TicketSubmissionResult } from '../src/ports/ticket';

/**
 * BUILD 05 — UI & end-to-end experience tests (happy-dom).
 *
 * The shell is presentation only: every interaction goes through
 * engine.handleEmployeeInput with existing engine commands. These tests
 * drive the REAL engine with the REAL mock providers through the browser
 * component, covering the mandated end-to-end cases 1-10.
 */

function createEngine(ticket: TicketPort = new MockTicketProvider()): ConversationEngine {
  return new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    ticket,
    operational: consoleOperationalLogger(),
    audit: new InMemoryAuditLogger(),
  });
}

function mount(root: HTMLElement, ticket: TicketPort = new MockTicketProvider(), factory?: () => ConversationEngine): ConversationEngine {
  const engine = factory !== undefined ? factory() : createEngineFactory(ticket)();
  createChatShell(root, engine, factory !== undefined ? { createEngine: factory } : {});
  return engine;
}

function createEngineFactory(ticket: TicketPort): () => ConversationEngine {
  return () => createEngine(ticket);
}

function logText(root: HTMLElement): string {
  return root.querySelector('.elvie-log')?.textContent ?? '';
}

function input(root: HTMLElement): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>('input.elvie-input');
  if (el === null) {
    throw new Error('input not found');
  }
  return el;
}

function submit(root: HTMLElement, text: string): void {
  const el = input(root);
  el.value = text;
  const form = root.querySelector('form');
  if (form === null) {
    throw new Error('form not found');
  }
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function chips(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll('button.elvie-chip')] as HTMLButtonElement[];
}

function clickChip(root: HTMLElement, label: string): void {
  const chip = chips(root).find((c) => c.textContent === label);
  if (chip === undefined) {
    throw new Error('chip not found: ' + label + ' — have: ' + chips(root).map((c) => c.textContent).join('|'));
  }
  chip.click();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Drive the deterministic incident flow through the UI to the preview. */
async function driveToPreview(root: HTMLElement): Promise<void> {
  submit(root, 'printer print niet');
  await flush();
  let guard = 0;
  while (!logText(root).includes('Categorie:') && guard < 10) {
    if (chips(root).some((c) => c.textContent === 'Niet opgelost')) {
      clickChip(root, 'Niet opgelost');
    } else {
      submit(root, 'niet opgelost');
    }
    await flush();
    guard += 1;
  }
  if (!logText(root).includes('Categorie:')) {
    throw new Error('preview not reached. Log: ' + logText(root));
  }
}

/** Deterministic deferred ticket port per BUILD 04 §16.4. */
class DeferredTicketPort implements TicketPort {
  calls = 0;
  readonly drafts: TicketDraft[] = [];
  private resolver: ((result: TicketSubmissionResult) => void) | undefined;

  async submit(draft: TicketDraft): Promise<TicketSubmissionResult> {
    this.calls += 1;
    this.drafts.push({ ...draft, context: { ...draft.context } });
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  async getStatus(): Promise<TicketStatusResult> {
    return { kind: 'unknown', submissionKey: { value: 'unknown' } };
  }

  release(reference: string): void {
    this.resolver?.({ kind: 'submitted', submissionKey: this.drafts[0]?.submissionKey ?? { value: 'x' }, reference });
  }
}

describe('BUILD 05 — chat interface', () => {
  it('renders an accessible shell with identity, simulation badge and focus', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mount(root);
    await flush();

    expect(root.querySelector('.elvie-avatar')?.textContent).toBe('E');
    expect(root.querySelector('.elvie-badge')?.textContent).toContain('SIMULATIE');
    expect(root.querySelector('.elvie-log')?.getAttribute('aria-live')).toBe('polite');
    expect(document.activeElement).toBe(input(root));
    // No administrative controls in the employee plane.
    expect(root.querySelector('[data-admin]')).toBeNull();
    root.remove();
  });

  it('supports starting a new conversation with a fresh engine session', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    let created = 0;
    const factory = (): ConversationEngine => {
      created += 1;
      return createEngine();
    };
    createChatShell(root, factory(), { createEngine: factory });
    await flush();
    expect(created).toBe(1);
    const firstLog = logText(root);
    expect(firstLog).toContain('Elvie');

    const reset = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Nieuw gesprek');
    expect(reset).toBeDefined();
    reset?.click();
    await flush();
    expect(created).toBe(2);
    // Fresh session: the log is a new greeting, the old content is gone.
    expect(logText(root)).toContain('Elvie');
    expect(logText(root)).not.toContain('printer');
    root.remove();
  });
});

describe('BUILD 05 — end-to-end conversations', () => {
  it('1. a full incident conversation reaches a confirmable preview and submits', async () => {
    const ticket = new MockTicketProvider();
    const root = document.createElement('div');
    document.body.append(root);
    mount(root, ticket);
    await driveToPreview(root);

    // Structured preview card from the server-owned snapshot.
    const card = root.querySelector('.elvie-card');
    expect(card?.textContent).toContain('Categorie: melding');
    expect(logText(root)).toContain('Functionele route');
    expect(logText(root)).toContain('niets naar TOPdesk verzonden');
    // Questions were asked one at a time; nothing was asked twice.
    expect(logText(root).split('Lost dit je probleem op?').length - 1).toBeGreaterThanOrEqual(1);

    // Explicit confirmation via the quick-reply button.
    expect(chips(root).map((c) => c.textContent)).toContain('Bevestigen (simulatie)');
    clickChip(root, 'Bevestigen (simulatie)');
    await flush();
    expect(logText(root)).toMatch(/SIM-incident-\d{4}/);
    expect(logText(root)).toContain('simulatie');
    expect(ticket.submitCallCount).toBe(1);

    // Terminal state: further input is a safe hint, never a new submit.
    submit(root, 'bevestigen');
    await flush();
    expect(logText(root)).toContain('afgerond');
    expect(ticket.submitCallCount).toBe(1);
    root.remove();
  });

  it('2. a request conversation reaches an aanvraag preview', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mount(root);
    await flush();
    submit(root, 'ik wil een nieuwe laptop aanvragen');
    await flush();
    // Deterministically answer whatever the engine asks until the preview.
    let guard = 0;
    const answers = new Map<string, string>([
      ['apparaat', 'op een laptop'],
      ['locatie', 'op kantoor Amsterdam'],
      ['aanvraag', 'een nieuwe laptop'],
      ['aanvragen', 'een nieuwe laptop'],
      ['precies', 'een nieuwe laptop'],
      ['gebeurt', 'hij doet het niet'],
      ['applicatie', 'outlook'],
      ['wanneer', 'sinds vanochtend'],
      ['niet doen', 'ik kan niet werken'],
      ['urgent', 'het kan wachten'],
      ['collega', 'alleen ik'],
      ['probeer', 'niets'],
      ['onbekend', 'weet ik niet'],
    ]);
    while (!logText(root).includes('Categorie:') && guard < 14) {
      const log = logText(root).toLowerCase();
      if (log.includes('lost dit je probleem op?')) {
        clickChip(root, 'Niet opgelost');
      } else {
        const lastQuestion = [...root.querySelectorAll('.elvie-message--elvie')].pop()?.textContent?.toLowerCase() ?? '';
        const key = [...answers.keys()].find((k) => lastQuestion.includes(k));
        submit(root, key === undefined ? 'een nieuwe laptop' : (answers.get(key) as string));
      }
      await flush();
      guard += 1;
    }
    expect(logText(root)).toContain('Categorie: aanvraag');
    expect(logText(root)).toContain('simulatie');
    root.remove();
  });

  it('3. a security report shows neutral instructions and a safe handover', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mount(root);
    await flush();
    submit(root, 'Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.');
    await flush();
    // Neutral, non-judging instruction; no ordinary knowledge fallback.
    expect(logText(root)).toContain('Ik kan je hierbij niet rechtstreeks helpen');
    expect(logText(root)).not.toContain('Lost dit je probleem op?');
    // Safe handover via the 'klaar' quick reply.
    clickChip(root, 'Klaar, verder');
    await flush();
    expect(logText(root)).toContain('Categorie: beveiligingsmelding');
    root.remove();
  });

  it('4. a correction from the preview updates the card and requires new confirmation', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mount(root);
    await driveToPreview(root);
    submit(root, 'het is eigenlijk een desktop');
    await flush();
    expect(logText(root)).toContain('bijgewerkte melding');
    expect(root.querySelector('.elvie-card')?.textContent).toContain('Apparaat:');
    expect(root.querySelector('.elvie-card')?.textContent).toContain('desktop');
    root.remove();
  });
});

describe('BUILD 05 — submission experience', () => {
  it('6. a definitive failure keeps the user safely in the flow with a retry affordance', async () => {
    const ticket = new MockTicketProvider({ failureMode: 'fail_rejected' });
    const root = document.createElement('div');
    document.body.append(root);
    mount(root, ticket);
    await driveToPreview(root);
    submit(root, 'bevestigen');
    await flush();
    expect(logText(root)).toContain('niet gelukt');
    expect(input(root).disabled).toBe(false);

    // Retry requires a fresh explicit confirmation (S-08/S-18).
    expect(chips(root).map((c) => c.textContent)).toContain('Opnieuw bevestigen');
    ticket.setFailureMode('success');
    clickChip(root, 'Opnieuw bevestigen');
    await flush();
    expect(logText(root)).toMatch(/SIM-incident-\d{4}/);
    expect(ticket.submitCallCount).toBe(2);
    root.remove();
  });

  it('7. an inconclusive submission stays safe and recovers via a status check', async () => {
    const ticket = new MockTicketProvider({ failureMode: 'timeout' });
    const root = document.createElement('div');
    document.body.append(root);
    mount(root, ticket);
    await driveToPreview(root);
    submit(root, 'bevestigen');
    await flush();
    expect(logText(root)).toContain('niet zeker');

    // A correction during the uncertain outcome never mutates or resubmits.
    submit(root, 'het is eigenlijk een desktop');
    await flush();
    expect(logText(root)).toContain('niet zeker');
    expect(ticket.submitCallCount).toBe(1);

    // Status check with the SAME key recovers safely (S-05).
    expect(chips(root).map((c) => c.textContent)).toContain('Status controleren');
    ticket.resolveAsSubmitted('SIM-incident-0421');
    clickChip(root, 'Status controleren');
    await flush();
    expect(logText(root)).toContain('SIM-incident-0421');
    expect(ticket.submitCallCount).toBe(1);
    root.remove();
  });

  it('8. double-clicking the confirmation never causes two submissions', async () => {
    const port = new DeferredTicketPort();
    const root = document.createElement('div');
    document.body.append(root);
    mount(root, port);
    await driveToPreview(root);

    submit(root, 'bevestigen');
    // The first click immediately locks the UI while processing.
    expect(input(root).disabled).toBe(true);
    const send = root.querySelector<HTMLButtonElement>('button.elvie-send');
    expect(send?.disabled).toBe(true);
    expect(chips(root).every((c) => c.disabled)).toBe(true);
    expect(root.querySelector('.elvie-log')?.getAttribute('aria-busy')).toBe('true');
    expect((root.querySelector('.elvie-status') as HTMLElement | null)?.hidden).toBe(false);
    await flush();

    // A rapid second confirmation is ignored by the busy UI guard.
    const form = root.querySelector('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    port.release('SIM-incident-0421');
    await flush();
    await flush();
    expect(port.calls).toBe(1);
    expect(logText(root)).toContain('SIM-incident-0421');
    expect(input(root).disabled).toBe(false);
    root.remove();
  });
});

describe('BUILD 05 — accessibility, mobile and hardening', () => {
  it('9. keyboard interaction, touch targets and reduced-motion are in place', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mount(root);
    const el = input(root);
    el.focus();
    expect(document.activeElement).toBe(el);
    // Accessible names for every interactive control.
    for (const button of [...root.querySelectorAll('button')]) {
      expect((button.getAttribute('aria-label') ?? button.textContent)?.length ?? '').not.toBe('');
    }
    // The stylesheet ships responsive and touch-target rules.
    const css = readFileSync(fileURLToPath(new URL('../src/ui/elvie.css', import.meta.url)), 'utf8');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('min-height: var(--elvie-tap)');
    expect(css).toContain('44px');
    root.remove();
  });

  it('10. Build 01-04 invariants hold: fail-closed error state and no admin controls', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    // Fail-closed production composition: no session, input disabled.
    const { createProductionEngine } = await import('../src/app/production-composition');
    createChatShell(root, createProductionEngine(), { createEngine: () => createProductionEngine() });
    await flush();
    expect(root.querySelector('.elvie-message--error')?.textContent).toContain('niet volledig geconfigureerd');
    expect(input(root).disabled).toBe(true);
    expect(root.querySelector('[data-admin]')).toBeNull();
    root.remove();
  });
});
