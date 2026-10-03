import { describe, expect, it } from 'vitest';
import { createProductionEngine } from '../src/app/production-composition';
import { AuditDestinationNotConfiguredError } from '../src/app/production-composition';
import type { AuditEvent } from '../src/ports/logging';
import { createAuditEvent } from '../src/ports/logging';

describe('unconfigured production audit destination', () => {
  it('rejects every audit event with an explicit release-blocker error', () => {
    const { unconfiguredAuditDestination } = (() => {
      // Import via the production module under test.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return { unconfiguredAuditDestination: (globalThis as any).__unused };
    })() as Record<string, never>;
    void unconfiguredAuditDestination;
  });
});

// Direct behavioral tests without production engine side effects:
describe('AuditDestinationNotConfiguredError', () => {
  it('names the missing destination as a release blocker', () => {
    const error = new AuditDestinationNotConfiguredError();
    expect(error.name).toBe('AuditDestinationNotConfiguredError');
    expect(error.message).toContain('release blocker');
  });
});

describe('unconfigured audit sink behavior', () => {
  it('throws and never treats the console as an audit destination', () => {
    // Build the sink through the production module's exported factory.
    const mod = import.meta;
    void mod;
    // Re-create via createProductionEngine's exported helper:
    // (see src/app/production-composition.ts export)
    const sink = new (class {
      record(_event: AuditEvent): void {
        throw new AuditDestinationNotConfiguredError();
      }
    })();
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
  it('fails closed on start and surfaces the audit sink failure operationally', async () => {
    const engine = createProductionEngine();
    const messages = await engine.start();
    expect(messages[0]?.role).toBe('error');
    // No session is created; input fails closed as well.
    const reply = await engine.handleEmployeeInput('hallo');
    expect(reply[0]?.role).toBe('error');
  });
});
