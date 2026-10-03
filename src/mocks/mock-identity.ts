import type { AuthenticatedEmployee, IdentityPort } from '../ports/identity';

/**
 * Development/test identity mock: a clearly fictional authenticated employee.
 * It does NOT pretend to implement Entra ID; it only satisfies the port so the
 * application foundation can be exercised locally. Never wire this mock in a
 * production composition (see src/app/production-composition.ts).
 */
export class MockIdentityProvider implements IdentityPort {
  private readonly employee: AuthenticatedEmployee;

  constructor(employee: AuthenticatedEmployee = { id: 'mock-employee-0001', displayName: 'Test Medewerker' }) {
    this.employee = employee;
  }

  async getCurrentEmployee(): Promise<AuthenticatedEmployee> {
    return this.employee;
  }
}
