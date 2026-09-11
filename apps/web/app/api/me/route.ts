import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, UserRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import {
  requireActiveSession,
  SessionGuardError,
  sessionGuardStatus,
} from '@/lib/session-guard';

export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  try {
    const active = await requireActiveSession();
    const users = new UserRepository(prisma);
    const memberships = await users.listMemberships(active.userId);
    return NextResponse.json(
      {
        id: active.userId,
        email: active.email,
        sessionVersion: active.sessionVersion,
        workspaces: memberships.map((m) => ({
          id: m.workspaceId,
          name: m.workspace.name,
          role: m.role,
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
