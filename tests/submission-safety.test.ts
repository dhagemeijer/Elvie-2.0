import { describe, expect, it } from 'vitest';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';
import type { TicketDraft, TicketPort, TicketStatusResult, TicketSubmissionResult, SubmissionKey } from '../src/ports/ticket';
import { makeSubmissionKey } from '../src/ports/ticket';

/**
 * BUILD 04D — Submission safety & mock adapter (§8–§10, §15.5–15.6, §16.4).
 *
 * Coverage map of the mandated submission cases:
 * 1.  Two concurrent confirmations -> max one logical submit ....... tests/submission-race.test.ts (S-01/F-11, deferred port per §16.4)
 * 2.  Valid submitted response -> CONFIRM .......................... tests/ticket-submission.test.ts (S-02)
 * 3.  Wrong key / missing reference -> no CONFIRM ................. tests/ticket-submission.test.ts (S-03)
 * 4.  Transport exception or timeout -> inconclusive ............... tests/ticket-submission.test.ts (S-04)
 * 5.  getStatus(originalKey) recovers safely to success ............ tests/ticket-submission.test.ts (S-05) + below
 * 6.  Unknown or invalid status -> stays inconclusive ............... tests/ticket-submission.test.ts (S-06)
 * 7.  Correction during inconclusive -> no mutation, no new submit .. below (S-07/F-12)
 * 8.  Definitive failure -> safe retry after reconfirmation ....... tests/ticket-submission.test.ts (S-08) + below (new key)
 * 9.  Unchanged draft retried after definitive failure ............ below (F-13/S-18)
 * 10. Already registered ticket -> no second registration .......... below (S-09)
 * 11. Same idempotency key with divergent content -> rejection ..... below (§4)
 * 12. Missing or invalid mock mapping -> no fictional fallback ..... below (§4/§9, R-09)
 * 13. No sensitive content in audit logs .......................... below (S-14)
 * 14. No Build 01–04C regressions ................................. full suite (verify workflow)
 *
 * SCOPE: all concurrency protection proven here is in-memory and valid
 * only for the single-instance mock runtime; cross-instance/restart
 * durability is a Build 06 release gate (§15.5/§16.2).
 */

function createEngine(ticket: TicketPort): { engine: ConversationEngine; audit: InMemoryAuditLogger } {
  const audit = new InMemoryAuditLogger();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new MockKnowledgeProvider(),
    ticket,
    operational: consoleOperationalLogger(),
    audit,
  });
  return { engine, audit };
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((message) => message.text).join('\n');
}

/** Deterministic happy path up to the PREVIEW state (mock knowledge). */
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

function draft(category: TicketDraft['category'], submissionKey: SubmissionKey, summary = 'Fictieve samenvatting'): TicketDraft {
  return {
    category,
    summary,
    description: 'Fictieve beschrijving (simulatie).',
    context: { subject: 'Account' },
    submissionKey,
  };
}

/** Scripted submission outcome without the key (echoed from the draft). */
type ScriptedSubmissionResult =
  | { readonly kind: 'failed'; readonly reasonCategory: 'rejected' | 'invalid_draft' }
  | { readonly kind: 'submitted'; readonly reference: string }
  | { readonly kind: 'unknown'; readonly reasonCategory: 'timeout' | 'transport' };

/** Scripted port per §16.4: records every call, key and an immutable draft copy. */
class ScriptedTicketPort implements TicketPort {
  calls = 0;
  readonly keys: string[] = [];
  readonly drafts: TicketDraft[] = [];

  constructor(private readonly script: readonly ScriptedSubmissionResult[]) {}

  async submit(d: TicketDraft): Promise<TicketSubmissionResult> {
    this.calls += 1;
    this.keys.push(d.submissionKey.value);
    this.drafts.push({ ...d, context: { ...d.context } });
    const result = this.script[this.calls - 1];
    if (result === undefined) {
      throw new Error('No scripted result for submit call ' + String(this.calls));
    }
    return { ...result, submissionKey: d.submissionKey };
  }

  async getStatus(submissionKey: SubmissionKey): Promise<TicketStatusResult> {
    return { kind: 'unknown', submissionKey };
  }
}

describe('BUILD 04D — submission safety (§15.5)', () => {
  it('a correction during an inconclusive outcome never mutates the draft or triggers a new submit (S-07/F-12)', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'timeout' });
    const { engine } = createEngine(tickets);
    await driveToPreview(engine);
    const inconclusive = text(await engine.handleEmployeeInput('versturen'));
    expect(inconclusive).toContain('niet zeker');
    expect(tickets.submitCallCount).toBe(1);

    const correction = text(await engine.handleEmployeeInput('het is eigenlijk een desktop'));
    expect(correction).toContain('niet zeker');
    expect(engine.currentState).toBe('PREVIEW');
    // No new submit and no new key: still exactly one attempt.
    expect(tickets.submitCallCount).toBe(1);

    // Recovery remains possible with the SAME key (S-05): a status check
    // resolves safely without any second registration.
    tickets.resolveAsSubmitted('SIM-incident-0421');
    const recovered = text(await engine.handleEmployeeInput('status'));
    expect(recovered).toContain('SIM-incident-0421');
    expect(engine.currentState).toBe('CONFIRM');
    expect(tickets.submitCallCount).toBe(1);
    expect(tickets.submittedDrafts).toHaveLength(0);
  });

  it('a definitive failure followed by an unchanged draft and a fresh confirmation uses exactly one NEW key (F-13/S-18)', async () => {
    const port = new ScriptedTicketPort([
      { kind: 'failed', reasonCategory: 'rejected' },
      { kind: 'submitted', reference: 'SIM-incident-0421' },
    ]);
    const { engine, audit } = createEngine(port);
    await driveToPreview(engine);
    const failed = text(await engine.handleEmployeeInput('bevestigen'));
    expect(failed).toContain('niet gelukt');
    expect(engine.currentState).toBe('PREVIEW');
    expect(port.calls).toBe(1);

    // Unchanged draft, fresh explicit confirmation: exactly one new
    // attempt with a NEW submission key; the old key stays with the old
    // attempt (S-18/D-7).
    const retried = text(await engine.handleEmployeeInput('bevestigen'));
    expect(retried).toContain('SIM-incident-0421');
    expect(engine.currentState).toBe('CONFIRM');
    expect(port.calls).toBe(2);
    expect(port.keys[0]).not.toBeNull();
    expect(port.keys[1]).not.toBeNull();
    expect(port.keys[0]).not.toBe(port.keys[1]);
    const [first, second] = port.drafts;
    if (first === undefined || second === undefined) {
      throw new Error('expected two recorded drafts');
    }
    expect({ ...first, submissionKey: undefined }).toEqual({ ...second, submissionKey: undefined });
    const events = audit.recordedEvents.filter((record) => record.action === 'submit_ticket');
    expect(events.map((event) => event.outcome)).toEqual(['failed', 'success']);
  });

  it('never registers an already registered ticket a second time (S-09)', async () => {
    const tickets = new MockTicketProvider();
    const { engine } = createEngine(tickets);
    await driveToPreview(engine);
    const submitted = text(await engine.handleEmployeeInput('bevestigen'));
    expect(submitted).toMatch(/SIM-incident-\d{4}/);
    expect(engine.currentState).toBe('CONFIRM');

    // After CONFIRM the session is terminal: no second attempt, key or
    // registration, and no in-place edit of the registered draft.
    const after = text(await engine.handleEmployeeInput('bevestigen'));
    expect(after).toContain('afgerond');
    expect(tickets.submitCallCount).toBe(1);
    expect(tickets.submittedDrafts).toHaveLength(1);

    // Mock level: the same key never creates a second ticket.
    const key = makeSubmissionKey('session-1', 1);
    const tickets2 = new MockTicketProvider();
    const first = await tickets2.submit(draft('incident', key));
    const again = await tickets2.submit(draft('incident', key));
    expect(again).toEqual(first);
    expect(tickets2.submittedDrafts).toHaveLength(1);
  });
});

describe('BUILD 04D — deterministic mock adapter (§4/§9)', () => {
  it('rejects the same idempotency key with divergent content in a controlled way (§4)', async () => {
    const tickets = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    const original = await tickets.submit(draft('incident', key, 'Samenvatting A'));
    expect(original.kind).toBe('submitted');

    const divergent = await tickets.submit(draft('incident', key, 'Samenvatting B'));
    expect(divergent).toMatchObject({ kind: 'failed', reasonCategory: 'invalid_draft' });
    expect(tickets.divergentContentRejectionCount).toBe(1);
    expect(tickets.submittedDrafts).toHaveLength(1);

    // The original registration stays untouched: same key, same content
    // still returns the original result and a consistent status.
    const repeated = await tickets.submit(draft('incident', key, 'Samenvatting A'));
    expect(repeated).toEqual(original);
    const status = await tickets.getStatus(key);
    expect(status.kind).toBe('submitted');
    expect(tickets.divergentContentRejectionCount).toBe(1);
  });

  it('rejects a draft without a valid mapping instead of inventing a default (R-09)', async () => {
    const key = makeSubmissionKey('session-1', 1);
    const unmapped = new MockTicketProvider({ mapping: {} });
    const missing = await unmapped.submit(draft('incident', key));
    expect(missing).toMatchObject({ kind: 'failed', reasonCategory: 'invalid_draft' });
    expect(unmapped.unmappedCategoryRejectionCount).toBe(1);
    expect(unmapped.submittedDrafts).toHaveLength(0);
    expect((await unmapped.getStatus(key)).kind).toBe('unknown');

    const invalid = new MockTicketProvider({ mapping: { incident: { operatorGroup: '   ' } } });
    const emptyEntry = await invalid.submit(draft('incident', key));
    expect(emptyEntry).toMatchObject({ kind: 'failed', reasonCategory: 'invalid_draft' });
    expect(invalid.unmappedCategoryRejectionCount).toBe(1);

    // The default fictional mapping explicitly covers every internal
    // category; no real TOPdesk group/category/priority/SLA is invented.
    for (const category of ['incident', 'request', 'security'] as const) {
      const tickets = new MockTicketProvider();
      const result = await tickets.submit(draft(category, makeSubmissionKey('s', 1)));
      expect(result.kind).toBe('submitted');
    }
  });
});

describe('BUILD 04D — audit and privacy (§10)', () => {
  it('audit events carry controlled codes only: no raw descriptions or secrets (S-14)', async () => {
    const tickets = new MockTicketProvider();
    const { engine, audit } = createEngine(tickets);
    await engine.start();
    // A sensitive value is refused server-side before any storage or audit.
    const warned = text(await engine.handleEmployeeInput('mijn bsn is 123456789'));
    expect(warned).toContain('gevoelige gegevens');

    await driveToPreview(engine);
    const submitted = text(await engine.handleEmployeeInput('bevestigen'));
    expect(submitted).toMatch(/SIM-incident-\d{4}/);

    const blob = JSON.stringify(audit.recordedEvents);
    // Controlled fields only: no raw intake text, no descriptions, no secrets.
    expect(blob).not.toContain('printer');
    expect(blob).not.toContain('print niet');
    expect(blob).not.toContain('123456789');
    expect(blob).not.toContain('bsn');
    expect(blob).not.toContain('wachtwoord');
    // Every audit event is a controlled structure with safe fields only.
    for (const event of audit.recordedEvents) {
      expect(typeof event.eventType).toBe('string');
      expect(['success', 'denied', 'failed', 'inconclusive']).toContain(event.outcome);
      if (event.targetId !== undefined) {
        expect(event.targetId).toMatch(/^SIM-(incident|request|security)-\d{4}$/);
      }
      expect(event.correlationId === 'none' || typeof event.correlationId === 'string').toBe(true);
    }
  });
});
