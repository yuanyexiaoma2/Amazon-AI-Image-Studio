import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, UserRepository } from '@studio/db';
import {
  requireActiveSession,
  SessionGuardError,
  sessionGuardStatus,
  type ActiveSession,
} from './session-guard';

export async function requireWorkspaceMember(
  workspaceId: string,
  requestId: string,
): Promise<
  | { ok: true; session: ActiveSession }
  | { ok: false; response: NextResponse }
> {
  try {
    const session = await requireActiveSession();
    const users = new UserRepository(prisma);
    const member = await users.isMemberOfWorkspace(session.userId, workspaceId);
    if (!member) {
      return {
        ok: false,
        response: NextResponse.json(
          makeApiError('FORBIDDEN', 'Cross-workspace access denied', requestId),
          { status: 403, headers: { 'x-request-id': requestId } },
        ),
      };
    }
    return { ok: true, session };
  } catch (err) {
    if (err instanceof SessionGuardError) {
      return {
        ok: false,
        response: NextResponse.json(makeApiError(err.code, err.message, requestId), {
          status: sessionGuardStatus(err),
          headers: { 'x-request-id': requestId },
        }),
      };
    }
    throw err;
  }
}
