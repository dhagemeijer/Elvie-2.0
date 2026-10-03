import { describe, expect, it } from 'vitest';
import {
  AuditDestinationNotConfiguredError,
  createProductionEngine,
  unconfiguredAuditDestination,
} from '../src/app/production-composition';
import { createAuditEvent } from '../src/ports/logging';

describe('unconfigured production audit destination', () => {
  it('names the missing destination as a release blocker', () => {
    const error = new AuditDestinationNotConfiguredError();
    expect(error.name).toBe('AuditDestinationNotConfiguredError');
    expect(error.message).toContain('release blocker');
  });

  it('rejects every audit event explicitly and never uses the console as an audit destination', () => {
    const sink = unconfiguredAuditDestination();
    expect(() =>
      sink.record(
        createAuditEvent({
          eventType: 'employee_session_establishment',
          actorId: 'mock-employee-0001',
          action: 'establish_session',
          outcome: 'failed',
          correlationId: 'session-1',
          component: 'conversation-engine',
          appVersion: '0.1.0',
        }),
      ),
    ).toThrow(AuditDestinationNotConfiguredError);
  });
});

describe('production engine with unconfigured audit destination', () => {
  it('fails closed on start and grants no session', async () => {
    const engine = createProductionEngine();
    const messages = await engine.start();
    expect(messages[0]?.role).toBe('error');
    const reply = await engine.handleEmployeeInput('hallo');
    expect(reply[0]?.role).toBe('error');
  });
});
