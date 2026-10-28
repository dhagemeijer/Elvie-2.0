import { describe, expect, it } from 'vitest';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';
import type { TicketDraft, TicketPort, TicketStatusResult, TicketSubmissionResult, SubmissionKey } from '../src/ports/ticket';

/**
 * Deferred TicketPort (BUILD_04 §16.4 race recipe): submit() stays pending
 * until the test releases it, so the engine's per-session serialisation and
 * the §15.5 in-flight claim can be verified deterministically.
 */
class DeferredTicketPort implements TicketPort {
  calls = 0;
  readonly keys = new Set<string>();
  readonly drafts: TicketDraft[] = [];
  private resolver: ((result: TicketSubmissionResult) => void) | undefined;

  async submit(draft: TicketDraft): Promise<TicketSubmissionResult> {
    this.calls += 1;
    this.keys.add(draft.submissionKey.value);
    this.drafts.push({ ...draft, context: { ...draft.context } });
    return new Promise<TicketSubmissionResult>((resolve) => {
      this.resolver = resolve;
    });
  }

  async getStatus(submissionKey: SubmissionKey): Promise<TicketStatusResult> {
    return { kind: 'unknown', submissionKey };
  }

  release(reference = 'SIM-incident-0001'): void {
    const draft = this.drafts[this.calls - 1];
    if (this.resolver !== undefined && draft !== undefined) {
      this.resolver({ kind: 'submitted', submissionKey: draft.submissionKey, reference });
    }
  }
}

function createEngine(ticket: DeferredTicketPort): ConversationEngine {
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

async function driveToPreview(engine: ConversationEngine): Promise<void> {
  await engine.start();
  await engine.handleEmployeeInput('printer print niet');
  let reply = await engine.handleEmployeeInput('niet opgelost');
  let guard = 0;
  while (!text(reply).includes('Categorie:') && guard < 8) {
    reply = await engine.handleEmployeeInput('niet opgelost');
    guard += 1;
  }
}

async function flush(times = 200): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe('ConversationEngine — submission concurrency (§15.5, F-11/S-01/S-16)', () => {
  it('two concurrent confirmations cause exactly one submit, one key and no double submission', async () => {
    const port = new DeferredTicketPort();
    const engine = createEngine(port);
    await driveToPreview(engine);
    expect(port.calls).toBe(0);

    const first = engine.handleEmployeeInput('bevestigen');
    await flush();
    // The first confirmation is pending INSIDE the port.
    expect(port.calls).toBe(1);

    const second = engine.handleEmployeeInput('bevestigen');
    await flush();
    port.release();
    const [firstReply, secondReply] = await Promise.all([first, second]);

    expect(port.calls).toBe(1);
    expect(port.keys.size).toBe(1);
    expect(port.drafts.length).toBe(1);
    expect(text(firstReply)).toContain('SIM-incident-0001');
    expect(engine.currentState).toBe('CONFIRM');
    // The second confirmation is processed after the completed first turn
    // (CONFIRM): never a second submit, never a second key.
    expect(text(secondReply)).toContain('afgerond');
  });

  it('a correction issued while a submission is in flight can never mutate the claimed draft', async () => {
    const port = new DeferredTicketPort();
    const engine = createEngine(port);
    await driveToPreview(engine);

    const first = engine.handleEmployeeInput('versturen');
    await flush();
    expect(port.calls).toBe(1);
    const claimedDraft = { ...port.drafts[0], context: { ...port.drafts[0].context } };

    const correction = engine.handleEmployeeInput('het is eigenlijk een desktop');
    await flush();
    port.release();
    await Promise.all([first, correction]);

    expect(port.calls).toBe(1);
    expect(port.drafts.length).toBe(1);
    expect(port.drafts[0].context).toEqual(claimedDraft.context);
    expect(engine.currentState).toBe('CONFIRM');
  });
});
