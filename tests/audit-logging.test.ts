import { describe, expect, it } from 'vitest';
import { InMemoryAuditLogger } from '../src/mocks/in-memory-audit-logger';
import { createAuditEvent } from '../src/ports/logging';
import { SENSITIVE_VALUE_PATTERNS } from '../src/security/sensitive-values';

/**
 * Representative sensitive values that must never appear in audit events
 * (per AUDIT_LOGGING.md "Never log by default").
 */
const REPRESENTATIVE_SENSITIVE_STRINGS = [
  '123456789', // BSN-shaped
  'NL91ABNA0417164300', // IBAN
  'supersecret-password-123',
  'Bearer eyJhbGciOiJIUzI1NiJ9.mock-token',
];

describe('audit logging contract', () => {
  it('accepts a safe structured administrative/security event', () => {
    const audit = new InMemoryAuditLogger();
    audit.record(
      createAuditEvent({
        eventType: 'administrative_authentication',
        actorId: 'mock-employee-0001',
        actorRole: 'employee',
        action: 'establish_session',
        outcome: 'success',
        correlationId: 'session-1',
        component: 'conversation-engine',
        appVersion: '0.1.0',
      }),
    );
    const event = audit.recordedEvents[0];
    expect(event).toBeDefined();
    expect(event?.outcome).toBe('success');
    expect(event?.actorId).toBe('mock-employee-0001');
  });

  it('emitted audit events do not contain representative sensitive strings', () => {
    const audit = new InMemoryAuditLogger();
    audit.record(
      createAuditEvent({
        eventType: 'incident_submission',
        actorId: 'mock-employee-0001',
        action: 'submit_incident',
        targetType: 'incident',
        targetId: 'MOCK-INCIDENT-0001',
        outcome: 'success',
        correlationId: 'session-1',
        component: 'conversation-engine',
        appVersion: '0.1.0',
      }),
    );
    const serialized = JSON.stringify(audit.recordedEvents);
    for (const sensitive of REPRESENTATIVE_SENSITIVE_STRINGS) {
      expect(serialized).not.toContain(sensitive);
    }
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      expect(pattern.test(serialized)).toBe(false);
    }
  });

  it('has no contract field that requires raw conversation or incident content', () => {
    const audit = new InMemoryAuditLogger();
    const event = createAuditEvent({
      eventType: 'configuration_change',
      actorId: 'mock-admin-0001',
      action: 'change_security_configuration',
      targetType: 'configuration',
      targetId: 'fictional-setting',
      outcome: 'denied',
      correlationId: 'session-2',
      component: 'conversation-engine',
      appVersion: '0.1.0',
    });
    audit.record(event);
    const keys = Object.keys(audit.recordedEvents[0] ?? {});
    expect(keys).toEqual(
      expect.arrayContaining([
        'timestamp',
        'eventType',
        'actorId',
        'action',
        'outcome',
        'correlationId',
        'component',
        'appVersion',
      ]),
    );
    expect(keys).not.toContain('conversationTranscript');
    expect(keys).not.toContain('description');
    expect(keys).not.toContain('userInput');
  });
});
