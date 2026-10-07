import { describe, expect, it } from 'vitest';
import type { KnowledgePort, KnowledgeSearchQuery, KnowledgeSearchResponse } from '../src/ports/knowledge';
import { isContractValidSubmission, makeSubmissionKey, type SubmissionKey } from '../src/ports/ticket';
import { ConversationEngine } from '../src/services/conversation-engine';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { MockKnowledgeProvider } from '../src/mocks/mock-knowledge';
import { MockTicketProvider } from '../src/mocks/mock-ticket';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { consoleOperationalLogger } from '../src/mocks/console-operational-logger';

const NO_RESULTS: KnowledgeSearchResponse = { results: [], outcome: 'no_results' };

class EmptyKnowledgeProvider implements KnowledgePort {
  async search(_query: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
    return NO_RESULTS;
  }
}

function createEngine(
  tickets: MockTicketProvider,
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

describe('TicketPort contract (BUILD_03.md par. 12-13)', () => {
  it('returns a non-empty fictional SIM reference and the exact submission key', async () => {
    const tickets = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    const result = await tickets.submit(
      { category: 'incident', summary: 'incident — printer', description: 'Simulatie.', context: {} },
      key,
    );
    expect(result.status).toBe('submitted');
    if (result.status === 'submitted') {
      expect(result.reference).toBe('SIM-incident-0001');
      expect(result.submissionKey).toBe(key.value);
    }
  });

  it('is idempotent per submission key: no duplicate tickets', async () => {
    const tickets = new MockTicketProvider();
    const key = makeSubmissionKey('session-1', 1);
    const draft = { category: 'incident' as const, summary: 's', description: 'd', context: {} };
    const first = await tickets.submit(draft, key);
    const second = await tickets.submit(draft, key);
    expect(second).toEqual(first);
    expect(tickets.submitCallCount).toBe(2);
    expect(tickets.submittedDrafts).toHaveLength(1);
  });

  it('creates separate tickets for separate submission keys', async () => {
    const tickets = new MockTicketProvider();
    const draft = { category: 'incident' as const, summary: 's', description: 'd', context: {} };
    await tickets.submit(draft, makeSubmissionKey('session-1', 1));
    await tickets.submit(draft, makeSubmissionKey('session-1', 2));
    expect(tickets.submittedDrafts).toHaveLength(2);
  });

  it('checks status with the same key, even without a received reference', async () => {
    const tickets = new MockTicketProvider();
    const unknownKey = makeSubmissionKey('session-x', 1);
    const unknown = await tickets.getStatus(unknownKey);
    expect(unknown.status).toBe('inconclusive');
    const key = makeSubmissionKey('session-1', 1);
    await tickets.submit(
      { category: 'request', summary: 'request — laptop', description: 'Simulatie.', context: {} },
      key,
    );
    const known = await tickets.getStatus(key);
    expect(known.status).toBe('submitted');
    if (known.status === 'submitted') {
      expect(known.reference).toBe('SIM-request-0001');
    }
  });

  it('reports definitive failures as failed without any reference', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'fail_rejected' });
    const key = makeSubmissionKey('session-1', 1);
    const result = await tickets.submit(
      { category: 'incident', summary: 's', description: 'd', context: {} },
      key,
    );
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reasonCategory).toBe('rejected');
    }
    expect('reference' in result).toBe(false);
  });

  it('surfaces timeout and transport failures as exceptions (engine: inconclusive)', async () => {
    for (const failureMode of ['timeout', 'transport'] as const) {
      const tickets = new MockTicketProvider({ failureMode });
      await expect(
        tickets.submit(
          { category: 'incident', summary: 's', description: 'd', context: {} },
          makeSubmissionKey('session-1', 1),
        ),
      ).rejects.toThrow();
    }
  });

  it('validates the submission contract before acceptance', () => {
    const key: SubmissionKey = { value: 'session-1#1' };
    expect(
      isContractValidSubmission({ status: 'submitted', submissionKey: 'session-1#1', reference: 'SIM-incident-0001' }, key),
    ).toBe(true);
    expect(
      isContractValidSubmission({ status: 'submitted', submissionKey: 'session-1#1', reference: '   ' }, key),
    ).toBe(false);
    expect(
      isContractValidSubmission({ status: 'submitted', submissionKey: 'session-1#2', reference: 'SIM-incident-0001' }, key),
    ).toBe(false);
    expect(
      isContractValidSubmission({ status: 'failed', submissionKey: 'session-1#1', reasonCategory: 'rejected' }, key),
    ).toBe(false);
  });
});

describe('engine submission protocol (BUILD_03.md par. 13)', () => {
  it('confirms only after a successful simulated submission', async () => {
    const tickets = new MockTicketProvider();
    const { engine, audit } = createEngine(tickets);
    const preview = await driveToPreview(engine);
    expect(preview).toContain('simulatie');
    const submitted = text(await engine.handleEmployeeInput('versturen'));
    expect(submitted).toMatch(/SIM-incident-\d{4}/);
    expect(submitted).toContain('geen echte TOPdesk');
    expect(engine.currentState).toBe('CONFIRM');
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket');
    expect(event?.outcome).toBe('success');
    expect(event?.targetId).toMatch(/^SIM-incident-\d{4}$/);
  });

  it('stays in PREVIEW on a definitive failure and allows a new explicit attempt', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'fail_rejected' });
    const { engine, audit } = createEngine(tickets);
    await driveToPreview(engine);
    const failed = text(await engine.handleEmployeeInput('versturen'));
    expect(failed).toContain('definitief niet gelukt');
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
    expect(inconclusive).toContain('niet zeker');
    expect(engine.currentState).toBe('PREVIEW');
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket');
    expect(event?.outcome).toBe('failed');
    expect(event?.reason).toBe('submission_inconclusive');

    const again = text(await engine.handleEmployeeInput('versturen'));
    expect(again).toContain('niet zeker');
    expect(engine.currentState).toBe('PREVIEW');
    expect(tickets.submitCallCount).toBe(1);
    const third = text(await engine.handleEmployeeInput('versturen'));
    expect(tickets.submitCallCount).toBe(1);
    expect(third).toContain('status');
  });

  it('recovers an uncertain outcome exclusively via the status check', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'timeout' });
    const { engine, audit } = createEngine(tickets);
    await driveToPreview(engine);
    await engine.handleEmployeeInput('versturen');
    expect(tickets.submitCallCount).toBe(1);
    tickets.resolveAsSubmitted('SIM-incident-0421');
    const recovered = text(await engine.handleEmployeeInput('versturen'));
    expect(recovered).toContain('SIM-incident-0421');
    expect(engine.currentState).toBe('CONFIRM');
    expect(tickets.submitCallCount).toBe(1);
    expect(tickets.submittedDrafts).toHaveLength(0);
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket' && record.outcome === 'success');
    expect(event?.targetId).toBe('SIM-incident-0421');
  });

  it('keeps the outcome inconclusive when the status check fails', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'transport', statusCheckMode: 'exception' });
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
    expect(engine.currentState).toBe('PREVIEW');
    const event = audit.recordedEvents.find((record) => record.action === 'submit_ticket');
    expect(event?.outcome).toBe('failed');
    expect(event?.reason).toBe('submission_contract_violation');
  });

  it('never reaches CONFIRM on a wrong submission key (contract violation)', async () => {
    const tickets = new MockTicketProvider({ failureMode: 'wrong_key' });
    const { engine } = createEngine(tickets);
    await driveToPreview(engine);
    const reply = text(await engine.handleEmployeeInput('versturen'));
    expect(reply).not.toContain('vastgelegd met referentie SIM-incident-9999');
    expect(engine.currentState).toBe('PREVIEW');
  });

  it('never suggests a real TOPdesk registration anywhere in the flow', async () => {
    const tickets = new MockTicketProvider();
    const { engine } = createEngine(tickets);
    const preview = await driveToPreview(engine);
    expect(preview).toContain('simulatie');
    const submitted = text(await engine.handleEmployeeInput('versturen'));
    expect(submitted).toContain('simulatie');
    expect(submitted).toContain('geen echte TOPdesk');
  });
});

describe('mock knowledge defaults still serve the port contract', () => {
  it('returns controlled results for an allowlist query', async () => {
    const knowledge = new MockKnowledgeProvider();
    const response = await knowledge.search({
      intent: 'request',
      subject: 'Account',
      symptom: undefined,
      requestedResource: 'Account',
      keywords: ['Account'],
    });
    expect(response.outcome).toBe('ok');
    expect(response.results[0]?.id).toBe('mock-kb-001');
  });
});
