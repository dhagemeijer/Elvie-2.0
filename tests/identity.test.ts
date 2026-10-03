import { describe, expect, it } from 'vitest';
import { MockIdentityProvider } from '../src/mocks/mock-identity';
import { IdentityNotConfiguredError, unconfiguredIdentity } from '../src/ports/identity';

describe('identity port', () => {
  it('mock resolves a clearly fictional employee', async () => {
    const identity = new MockIdentityProvider();
    const employee = await identity.getCurrentEmployee();
    expect(employee.id).toBe('mock-employee-0001');
    expect(employee.displayName).toBe('Test Medewerker');
  });

  it('unconfigured production identity fails closed and grants no access', async () => {
    const identity = unconfiguredIdentity();
    await expect(identity.getCurrentEmployee()).rejects.toThrow(IdentityNotConfiguredError);
  });

  it('unconfigured identity never resolves a user, privileged or otherwise', async () => {
    const identity = unconfiguredIdentity();
    let resolved: unknown = 'not-called';
    await identity.getCurrentEmployee().then(
      () => {
        resolved = 'resolved';
      },
      (error: unknown) => {
        resolved = error instanceof Error ? error.name : 'rejected';
      },
    );
    expect(resolved).toBe('IdentityNotConfiguredError');
  });
});
