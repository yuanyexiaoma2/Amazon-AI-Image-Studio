import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, UserRepository } from '@studio/db';
import type { WorkspaceRoleName } from '@studio/domain';
import {
  requireActiveSession,
  requirePaidSession,
  SessionGuardError,
  sessionGuardStatus,
  type ActiveSession,
} from './session-guard';
import { isLocalMode } from './local-mode';

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

/**
 * PR-6 paid gate: in LOCAL_MODE, browsing/editing runs as the local principal
 * but actions that spend credits or call paid providers still require a real
 * signed-in account. Returns a 401 response when login is required, else null.
 * No-op outside LOCAL_MODE (those routes already required auth above).
 */
export async function paidGateResponse(requestId: string): Promise<NextResponse | null> {
  if (!isLocalMode()) return null;
  try {
    await requirePaidSession();
    return null;
  } catch (err) {
    if (err instanceof SessionGuardError) {
      return NextResponse.json(
        makeApiError(err.code, '生图需要登录账号', requestId),
        { status: sessionGuardStatus(err), headers: { 'x-request-id': requestId } },
      );
    }
    throw err;
  }
}
