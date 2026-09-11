import { NextResponse } from 'next/server';
import { z } from 'zod';
import { makeApiError } from '@studio/contracts';
import { prisma, UserRepository } from '@studio/db';
import { hashPassword, verifyPassword } from '@/lib/password';
import { getOrCreateRequestId } from '@/lib/request-id';
import {
  requireActiveSession,
  SessionGuardError,
  sessionGuardStatus,
} from '@/lib/session-guard';

const BodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

/** Stub endpoint: change password and bump sessionVersion (invalidates other JWTs). */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  try {
    const active = await requireActiveSession();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', 'Invalid payload', requestId, parsed.error.flatten()),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }

    const users = new UserRepository(prisma);
    const user = await users.findById(active.userId);
    if (!user) {
      return NextResponse.json(makeApiError('UNAUTHENTICATED', 'User not found', requestId), {
        status: 401,
        headers: { 'x-request-id': requestId },
      });
    }

    const ok = await verifyPassword(user.passwordHash, parsed.data.currentPassword);
    if (!ok) {
      return NextResponse.json(makeApiError('UNAUTHORIZED', 'Current password incorrect', requestId), {
        status: 401,
        headers: { 'x-request-id': requestId },
      });
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    const updated = await users.changePassword(active.userId, passwordHash);
    return NextResponse.json(
      { ok: true, sessionVersion: updated.sessionVersion },
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
