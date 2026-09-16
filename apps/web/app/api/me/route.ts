import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, UserRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { auth } from '@/lib/auth';
import { isLocalMode } from '@/lib/local-mode';
import {
  requireActiveSession,
  SessionGuardError,
  sessionGuardStatus,
} from '@/lib/session-guard';

export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  try {
    const active = await requireActiveSession();
    // In LOCAL_MODE the caller acts as the local principal; `authenticated`
    // tells the frontend whether a real account session also exists (needed
    // for paid actions like generation).
    const realSession = isLocalMode() ? await auth() : null;
    const users = new UserRepository(prisma);
    const memberships = await users.listMemberships(active.userId);
    return NextResponse.json(
      {
        id: active.userId,
        email: active.email,
        sessionVersion: active.sessionVersion,
        localMode: isLocalMode(),
        authenticated: isLocalMode() ? Boolean(realSession?.user?.id) : true,
        workspaces: memberships.map((m) => ({
          id: m.workspaceId,
          name: m.workspace.name,
          role: m.role,
          autoApproveGates: m.workspace.autoApproveGates,
        })),
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof SessionGuardError) {
      return NextResponse.json(makeApiError(err.code, err.message, requestId), {
        status: sessionGuardStatus(err),
        headers: { 'x-request-id': requestId },
      });
    }
    throw err;
  }
}
