/**
 * Identity port. The production implementation will be Microsoft Entra ID
 * (Build 05). Build 01 only defines the contract plus a safe dev/test mock.
 */

/** An authenticated employee as reported by the trusted identity source. */
export interface AuthenticatedEmployee {
  /** Stable, non-sensitive identifier from the identity source. */
  readonly id: string;
  /** Display name for a friendly greeting. */
  readonly displayName: string;
}

export interface IdentityPort {
  /**
   * Resolve the current employee. Implementations must fail (reject) when
   * authentication is not available or not configured. Never return an
   * unauthenticated or invented user.
   */
  getCurrentEmployee(): Promise<AuthenticatedEmployee>;
}

/** Raised when no identity implementation is configured. Access is denied. */
export class IdentityNotConfiguredError extends Error {
  constructor(message = 'Identity provider is not configured; access is denied (fail closed).') {
    super(message);
    this.name = 'IdentityNotConfiguredError';
  }
}

/**
 * Fail-closed identity implementation used when no real provider is wired.
 * Used by the production composition so unconfigured access can never
 * silently fall back to a privileged or mock identity.
 */
export function unconfiguredIdentity(): IdentityPort {
  return {
    async getCurrentEmployee(): Promise<AuthenticatedEmployee> {
      throw new IdentityNotConfiguredError();
    },
  };
}
