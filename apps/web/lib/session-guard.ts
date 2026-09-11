import { prisma, UserRepository } from '@studio/db';
import { auth } from './auth';

export type ActiveSession = {
  userId: string;
  email: string | null | undefined;
  sessionVersion: number;
};

export class SessionGuardError extends Error {
  constructor(
    public readonly code: 'UNAUTHENTICATED' | 'SESSION_REVOKED' | 'ACCOUNT_DISABLED',
    message: string,
  ) {
    super(message);
    this.name = 'SessionGuardError';
  }
}

/**
 * Load Auth.js session and validate against DB:
 * - user must exist, ACTIVE, not soft-deleted
 * - JWT sessionVersion must match User.sessionVersion
 */
export async function requireActiveSession(): Promise<ActiveSession> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new SessionGuardError('UNAUTHENTICATED', 'Not signed in');
  }

  const users = new UserRepository(prisma);
  const user = await users.findById(session.user.id);
  if (!user || user.deletedAt) {
    throw new SessionGuardError('UNAUTHENTICATED', 'User not found');
  }
  if (user.status !== 'ACTIVE') {
    throw new SessionGuardError('ACCOUNT_DISABLED', 'Account disabled');
  }

  const tokenVersion = session.sessionVersion ?? 0;
  if (user.sessionVersion !== tokenVersion) {
    throw new SessionGuardError('SESSION_REVOKED', 'Session revoked (sessionVersion mismatch)');
  }

  return {
    userId: user.id,
    email: user.email,
    sessionVersion: user.sessionVersion,
  };
}

export function sessionGuardStatus(err: SessionGuardError): number {
  if (err.code === 'ACCOUNT_DISABLED') return 403;
  return 401;
}
