import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, UserRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import {
  requireActiveSession,
  SessionGuardError,
  sessionGuardStatus,
} from '@/lib/session-guard';

/** Stub endpoint: disable account and bump sessionVersion. */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  try {
    const active = await requireActiveSession();
    const users = new UserRepository(prisma);
    const updated = await users.disableAccount(active.userId);
    return NextResponse.json(
      { ok: true, status: updated.status, sessionVersion: updated.sessionVersion },
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
