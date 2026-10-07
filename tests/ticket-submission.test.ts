import { describe, expect, it } from 'vitest';
import type { KnowledgePort, KnowledgeSearchQuery, KnowledgeSearchResponse } from '../src/ports/knowledge';
import type { TicketDraft, TicketPort, TicketStatusResult, TicketSubmissionResult } from '../src/ports/ticket';
import { isContractValidStatus, isContractValidSubmission, makeSubmissionKey, type SubmissionKey } from '../src/ports/ticket';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';

const NO_RESULTS: KnowledgeSearchResponse = { results: [], outcome: 'no_results' };

class EmptyKnowledgeProvider implements KnowledgePort {
  async search(_query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
    return NO_RESULTS;
  }
}

/** Wraps the mock and returns a deliberately malformed status response. */
class MalformedStatusTicketProvider implements TicketPort {
  constructor(private readonly inner: MockTicketProvider, private readonly status: TicketStatusResult) {}
  async submit(draft: TicketDraft): Promise<TicketSubmissionResult> {
    return this.inner.submit(draft);
  }
  async getStatus(submissionKey: SubmissionKey): Promise<TicketStatusResult> {
    void submissionKey; // the malformed response deliberately ignores the requested key
    return this.status;
  }
}

function createEngine(
  tickets: TicketPort,
): { engine: ConversationEngine; audit: InMemoryAuditLogger } {
  const audit = new InMemoryAuditLogger();
  const engine = new ConversationEngine({
    identity: new MockIdentityProvider(),
    knowledge: new EmptyKnowledgeProvider(),
    ticket: tickets,
    operational: consoleOperationalLogger(),
    audit,
  });
  return { engine, audit };
}

function text(messages: readonly { text: string }[]): string {
  return messages.map((message) => message.text).join('\n');
}

/** Walk the deterministic happy path up to the PREVIEW state. */
async function driveToPreview(engine: ConversationEngine): Promise<string> {
  await engine.start();
  const reply = await engine.handleEmployeeInput('printer print niet');
  return text(reply);
}

function draft(category: TicketDraft['category'], submissionKey: SubmissionKey): TicketDraft {
  return {
    category,
    summary: 'Fictieve samenvatting',
    description: 'Fictieve beschrijving (simulatie).',
    context: { subject: 'Account' },
    submissionKey,
  };
}

describe('TicketPort submission contract (BUILD_03.md v5.2/v5.2.1 par. 10)', () => {
  it('returns a non-empty fictional SIM reference and the exact submission key', async () => {
    const tickets = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    const result = await tickets.submit(draft('incident', key));
    expect(result.kind).toBe('submitted');
    if (result.kind === 'submitted') {
      expect(result.reference).toBe('SIM-incident-0001');
      expect(result.submissionKey.value).toBe(key.value);
    }
  });

  it('is idempotent per submission key: no duplicate tickets', async () => {
    const tickets = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    const first = await tickets.submit(draft('incident', key));
    const second = await tickets.submit(draft('incident', key));
    expect(second).toEqual(first);
    expect(tickets.submitCallCount).toBe(2);
    expect(tickets.submittedDrafts).toHaveLength(1);
  });

  it('creates separate tickets for separate submission keys', async () => {
    const tickets = new MockTicketProvider();
    await tickets.submit(draft('incident', makeSubmissionKey('session-1', 1)));
    await tickets.submit(draft('incident', makeSubmissionKey('session-1', 2)));
    expect(tickets.submittedDrafts).toHaveLength(2);
  });

  it('reports definitive failures as failed without any reference', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'fail_rejected' });
    const key = makeSubmissionKey('session-1', 1);
    const result = await tickets.submit(draft('incident', key));
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reasonCategory).toBe('rejected');
    }
    expect('reference' in result).toBe(false);
  });

  it('surfaces timeout and transport as kind unknown (uncertain, no reference)', async () => {
    for (const failureMode of ['timeout', 'transport'] as const) {
      const tickets = new MockTicketProvider({ failureMode });
      const key = makeSubmissionKey('session-1', 1);
      const result = await tickets.submit(draft('incident', key));
      expect(result.kind).toBe('unknown');
      if (result.kind === 'unknown') {
        expect(result.reasonCategory).toBe(failureMode);
        expect('reference' in result).toBe(false);
      }
    }
  });

  it('validates the submission contract before acceptance (discriminated union)', () => {
    const key: SubmissionKey = { value: 'session-1#1' };
    expect(
      isContractValidSubmission(
        { kind: 'submitted', submissionKey: { value: 'session-1#1' }, reference: 'SIM-incident-0001' },
        key,
      ),
    ).toBe(true);
    expect(
      isContractValidSubmission(
        { kind: 'submitted', submissionKey: { value: 'session-1#1' }, reference: '   ' },
        key,
      ),
    ).toBe(false);
    expect(
      isContractValidSubmission(
        { kind: 'submitted', submissionKey: { value: 'session-1#2' }, reference: 'SIM-incident-0001' },
        key,
      ),
    ).toBe(false);
    expect(
      isContractValidSubmission(
        { kind: 'failed', submissionKey: { value: 'session-1#1' }, reasonCategory: 'rejected' } as unknown as TicketSubmissionResult,
        key,
      ),
    ).toBe(true);
    // failed/unknown with an (unauthorized) reference field is contradictory.
    expect(
      isContractValidSubmission(
        {
          kind: 'unknown',
          submissionKey: { value: 'session-1#1' },
          reasonCategory: 'timeout',
          reference: 'SIM-incident-0001',
        } as unknown as TicketSubmissionResult,
        key,
      ),
    ).toBe(false);
  });

  it('validates the status contract before CONFIRM (v5.2.1)', () => {
    const key: SubmissionKey = { value: 'session-1#1' };
    expect(
      isContractValidStatus({ kind: 'submitted', submissionKey: { value: 'session-1#1' }, reference: 'SIM-incident-0001' }, key),
    ).toBe(true);
    expect(isContractValidStatus({ kind: 'submitted', submissionKey: { value: 'session-1#1' }, reference: '' }, key)).toBe(false);
    expect(
      isContractValidStatus({ kind: 'submitted', submissionKey: { value: 'session-1#2' }, reference: 'SIM-incident-0001' }, key),
    ).toBe(false);
    expect(isContractValidStatus({ kind: 'unknown', submissionKey: { value: 'session-1#1' } }, key)).toBe(true);
    // unknown with an unauthorized reference field is contradictory.
    expect(
      isContractValidStatus(
        { kind: 'unknown', submissionKey: { value: 'session-1#1' }, reference: 'SIM-incident-0001' } as unknown as TicketStatusResult,
        key,
      ),
    ).toBe(false);
    expect(isContractValidStatus({ kind: 'unknown', submissionKey: { value: 'session-1#2' } }, key)).toBe(false);
  });

  it('checks status with the key alone, even without a received reference', async () => {
    const tickets = new MockTicketProvider();
    const unknownKey = makeSubmissionKey('session-x', 1);
    const unknown = await tickets.getStatus(unknownKey);
    expect(unknown.kind).toBe('unknown');
    expect('reference' in unknown).toBe(false);
    const key = makeSubmissionKey('session-1', 1);
    await tickets.submit(draft('request', key));
    const known = await tickets.getStatus(key);
    expect(known.kind).toBe('submitted');
    if (known.kind === 'submitted') {
      expect(known.reference).toBe('SIM-request-0001');
      expect(known.submissionKey.value).toBe(key.value);
    }
  });
});

describe('engine submission protocol (BUILD_03.md v5.2/v5.2.1 par. 11-12)', () => {
  it('confirms only after a successful simulated submission', async () => {
    const tickets = new MockTicketProvider();
    const { engine, audit } = createEngine(tickets);
    const preview = await driveToPreview(engine);
    expect(preview).toContain('simulatie');
    expect(preview).toContain('niets naar TOPdesk verzonden');
    const submitted = text(await engine.handleEmployeeInput('versturen'));
    expect(submitted).toMatch(/SIM-incident-\d{4}/);
    expect(submitted).toContain('geen echte TOPdesk');
    expect(engine.currentState).toBe('CONFIRM');
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket');
    expect(event?.eventType).toBe('ticket_submission');
    expect(event?.outcome).toBe('success');
    expect(event?.targetId).toMatch(/^SIM-incident-\d{4}$/);
  });

  it('stays in PREVIEW on a definitive failure and allows a new explicit attempt', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'fail_rejected' });
    const { engine, audit } = createEngine(tickets);
    await driveToPreview(engine);
    const failed = text(await engine.handleEmployeeInput('versturen'));
    expect(failed).toContain('versturen is niet gelukt');
    expect(failed).toContain('niets vastgelegd of verzonden');
    expect(engine.currentState).toBe('PREVIEW');
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket');
    expect(event?.outcome).toBe('failed');
    expect(event?.reason).toBe('rejected');

    tickets.setFailureMode('success');
    const retry = text(await engine.handleEmployeeInput('versturen'));
    expect(retry).toMatch(/SIM-incident-\d{4}/);
    expect(engine.currentState).toBe('CONFIRM');
    expect(tickets.submittedDrafts).toHaveLength(1);
  });

  it('treats a timeout as inconclusive and never resubmits on new input', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'timeout' });
    const { engine, audit } = createEngine(tickets);
    await driveToPreview(engine);
    const inconclusive = text(await engine.handleEmployeeInput('versturen'));
    expect(inconclusive).toContain('niet zeker of de simulatie');
    expect(inconclusive).toContain('niets opnieuw verstuurd');
    expect(engine.currentState).toBe('PREVIEW');
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket');
    expect(event?.outcome).toBe('inconclusive');
    expect(event?.reason).toBe('timeout');

    // Repeated 'versturen' input only repeats the status check: never a
    // second submit (port-call assertion).
    const again = text(await engine.handleEmployeeInput('versturen'));
    expect(again).toContain('niet zeker');
    expect(engine.currentState).toBe('PREVIEW');
    expect(tickets.submitCallCount).toBe(1);
    const third = text(await engine.handleEmployeeInput('status'));
    expect(tickets.submitCallCount).toBe(1);
    expect(third).toContain('niet zeker');
  });

  it('maps a submit exception (unknown transport error) to inconclusive, never failed', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'exception' });
    const { engine, audit } = createEngine(tickets);
    await driveToPreview(engine);
    const reply = text(await engine.handleEmployeeInput('versturen'));
    expect(reply).toContain('niet zeker of de simulatie');
    expect(engine.currentState).toBe('PREVIEW');
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket');
    expect(event?.outcome).toBe('inconclusive');
  });

  it('recovers an uncertain outcome exclusively via the status check with the same key', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'timeout' });
    const { engine, audit } = createEngine(tickets);
    await driveToPreview(engine);
    await engine.handleEmployeeInput('versturen');
    expect(tickets.submitCallCount).toBe(1);
    tickets.resolveAsSubmitted('SIM-incident-0421');
    const recovered = text(await engine.handleEmployeeInput('versturen'));
    expect(recovered).toContain('SIM-incident-0421');
    expect(recovered).toContain('geen echte TOPdesk');
    expect(engine.currentState).toBe('CONFIRM');
    // Proof that recovery causes no second submit.
    expect(tickets.submitCallCount).toBe(1);
    expect(tickets.submittedDrafts).toHaveLength(0);
    const event = audit.recordedEvents.find(
      (record) => record.action === 'submit_ticket' && record.outcome === 'success',
    );
    expect(event?.targetId).toBe('SIM-incident-0421');
  });

  it('keeps the outcome inconclusive when the status check throws', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'timeout', statusCheckMode: 'exception' });
    const { engine } = createEngine(tickets);
    await driveToPreview(engine);
    await engine.handleEmployeeInput('versturen');
    const still = text(await engine.handleEmployeeInput('versturen'));
    expect(still).toContain('niet zeker');
    expect(engine.currentState).toBe('PREVIEW');
    expect(tickets.submitCallCount).toBe(1);
  });

  it('keeps the outcome inconclusive on a valid kind unknown status response', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'timeout' });
    const { engine } = createEngine(tickets);
    await driveToPreview(engine);
    await engine.handleEmployeeInput('versturen');
    const still = text(await engine.handleEmployeeInput('versturen'));
    expect(still).toContain('niet zeker');
    expect(engine.currentState).toBe('PREVIEW');
    expect(tickets.submitCallCount).toBe(1);
  });

  it('never reaches CONFIRM on an empty submitted reference (contract violation)', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'empty_reference' });
    const { engine, audit } = createEngine(tickets);
    await driveToPreview(engine);
    const reply = text(await engine.handleEmployeeInput('versturen'));
    expect(reply).not.toMatch(/SIM-incident-\d{4}/);
    expect(reply).toContain('niet zeker');
    expect(engine.currentState).toBe('PREVIEW');
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket');
    expect(event?.outcome).toBe('inconclusive');
    expect(event?.reason).toBe('submission_contract_violation');
  });

  it('never reaches CONFIRM on a wrong submission key (contract violation)', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'wrong_key' });
    const { engine } = createEngine(tickets);
    await driveToPreview(engine);
    const reply = text(await engine.handleEmployeeInput('versturen'));
    expect(reply).not.toContain('SIM-incident-9999');
    expect(engine.currentState).toBe('PREVIEW');
  });

  it('never reaches CONFIRM on malformed status responses (v5.2.1 fail-closed)', async () => {
    const cases: Array<{ label: string; status: TicketStatusResult }> = [
      {
        label: 'submitted with an empty reference',
        status: { kind: 'submitted', submissionKey: { value: 'placeholder' }, reference: '' },
      },
      {
        label: 'submitted with a wrong submission key',
        status: { kind: 'submitted', submissionKey: { value: 'other#9' }, reference: 'SIM-incident-0422' },
      },
      {
        label: 'unknown with an unauthorized reference field',
        status: { kind: 'unknown', submissionKey: { value: 'placeholder' }, reference: 'SIM-incident-0423' } as unknown as TicketStatusResult,
      },
    ];
    for (const testCase of cases) {
      const tickets = new MockTicketProvider({ failureMode: 'timeout' });
      const { engine, audit } = createEngine(new MalformedStatusTicketProvider(tickets, testCase.status));
      await driveToPreview(engine);
      await engine.handleEmployeeInput('versturen');
      const reply = text(await engine.handleEmployeeInput('versturen'));
      expect(reply).toContain('niet zeker');
      expect(engine.currentState).toBe('PREVIEW');
      expect(tickets.submitCallCount).toBe(1);
      const violation = audit.recordedEvents.find(
        (record) => record.action === 'submit_ticket' && record.reason === 'submission_contract_violation',
      );
      expect(violation?.outcome).toBe('inconclusive');
      expect(engine.currentState).toBe('PREVIEW');
    }
  });

  it('never suggests a real TOPdesk registration anywhere in the flow', async () => {
    const tickets = new MockTicketProvider();
    const { engine } = createEngine(tickets);
    const preview = await driveToPreview(engine);
    expect(preview).toContain('simulatie');
    expect(preview).toContain('niets naar TOPdesk verzonden');
    const submitted = text(await engine.handleEmployeeInput('versturen'));
    expect(submitted).toContain('simulatie');
    expect(submitted).toContain('geen echte TOPdesk');
  });
});
