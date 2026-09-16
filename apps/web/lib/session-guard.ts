import { prisma, UserRepository } from '@studio/db';
import { auth } from './auth';
import { isLocalMode } from './local-mode';
import { ensureLocalPrincipal } from './local-principal';

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
 * Load session and validate against DB. In LOCAL_MODE every request acts as
 * the provisioned local principal (no login wall for browsing/editing); the
 * strict Auth.js flow below stays intact for non-local deployments.
 * Paid actions (generation / LLM calls) must use requirePaidSession() instead.
 */
export async function requireActiveSession(): Promise<ActiveSession> {
  if (isLocalMode()) {
    const local = await ensureLocalPrincipal();
    return {
      userId: local.user.id,
      email: local.user.email,
      sessionVersion: local.user.sessionVersion,
    };
  }

  return requirePaidSession();
}

/**
 * Strict Auth.js session check — deliberately ignores LOCAL_MODE. Call this at
 * paid boundaries (image generation, planner/chat LLM turns, vision extract):
 * browsing and canvas editing are free in local mode, spending is not.
 */
export async function requirePaidSession(): Promise<ActiveSession> {
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
