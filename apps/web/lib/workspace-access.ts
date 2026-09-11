import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, UserRepository } from '@studio/db';
import type { WorkspaceRoleName } from '@studio/domain';
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
  | { ok: true; session: ActiveSession; role: WorkspaceRoleName }
  | { ok: false; response: NextResponse }
> {
  try {
    const session = await requireActiveSession();
    const users = new UserRepository(prisma);
    const membership = await users.getMembership(session.userId, workspaceId);
    if (!membership) {
      return {
        ok: false,
        response: NextResponse.json(
          makeApiError('FORBIDDEN', 'Cross-workspace access denied', requestId),
          { status: 403, headers: { 'x-request-id': requestId } },
        ),
      };
    }
    return { ok: true, session, role: membership.role as WorkspaceRoleName };
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

export async function requireWorkspaceRoles(
  workspaceId: string,
  requestId: string,
  allowed: ReadonlyArray<WorkspaceRoleName>,
): Promise<
  | { ok: true; session: ActiveSession; role: WorkspaceRoleName }
  | { ok: false; response: NextResponse }
> {
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access;
  if (!allowed.includes(access.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        makeApiError('FORBIDDEN', `Role ${access.role} cannot perform this action`, requestId),
        { status: 403, headers: { 'x-request-id': requestId } },
      ),
    };
  }
  return access;
}
