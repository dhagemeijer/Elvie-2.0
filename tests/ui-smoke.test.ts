import { describe, expect, it } from 'vitest';
import { createChatShell } from '../src/ui/chat-shell';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';
import { unconfiguredIdentity } from '../src/ports/identity';

/** UI smoke test: initial chat interaction in happy-dom. */

function createTestEngine(): ConversationEngine {
  return new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    ticket: new MockTicketProvider(),
    operational: consoleOperationalLogger(),
    audit: new InMemoryAuditLogger(),
  });
}

function submitForm(root: HTMLElement): void {
  const form = root.querySelector('form');
  expect(form).not.toBeNull();
  form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function flush(): Promise<void> {
  // Let pending promises (engine start/turn) settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('chat shell (UI smoke)', () => {
  it('renders the shell, greeting, and handles a send interaction', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    createChatShell(root, createTestEngine());
    await flush();

    // Empty state becomes a greeting; input is enabled and focused.
    const input = root.querySelector<HTMLInputElement>('input.elvie-input');
    const send = root.querySelector<HTMLButtonElement>('button.elvie-send');
    expect(input).not.toBeNull();
    expect(send).not.toBeNull();
    expect(input?.disabled).toBe(false);
    expect(input?.getAttribute('aria-label')).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(root.querySelectorAll('.elvie-message--elvie').length).toBeGreaterThan(0);

    // Send a message.
    input!.value = 'wachtwoord vergeten';
    submitForm(root);
    await flush();

    const log = root.querySelector('.elvie-log');
    expect(log?.textContent).toContain('wachtwoord vergeten');
    // Build 03 offers a simulated knowledge article (never a real TOPdesk registration).
    expect(log?.textContent).toContain('Wachtwoord');
    expect(log?.textContent).toContain('simulatie');
    expect(input?.disabled).toBe(false);
    expect(input?.value).toBe('');

    // No administrative controls exist in the employee UI.
    expect(root.querySelector('[data-admin]')).toBeNull();
    expect(root.querySelectorAll('button').length).toBe(1);
    root.remove();
  });

  it('shows a clear error state when identity is not configured', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const engine = new ConversationEngine({
      identity: unconfiguredIdentity(),
      knowledge: new MockKnowledgeProvider(),
      ticket: new MockTicketProvider(),
      operational: consoleOperationalLogger(),
      audit: new InMemoryAuditLogger(),
    });
    createChatShell(root, engine);
    await flush();

    const error = root.querySelector('.elvie-message--error');
    expect(error?.textContent).toContain('niet volledig geconfigureerd');
    // Fail closed: input stays disabled.
    const input = root.querySelector<HTMLInputElement>('input.elvie-input');
    expect(input?.disabled).toBe(true);
    root.remove();
  });
});
