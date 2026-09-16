import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { RUN_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  GenerationRepository,
  GenerationNotFoundError,
  GenerationConflictError,
  CreditInsufficientError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { paidGateResponse, requireWorkspaceRoles } from '@/lib/workspace-access';
import { enqueueGenerationFromOutbox } from '@/lib/queues';

type Ctx = { params: Promise<{ workspaceId: string; attemptId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, attemptId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...RUN_WRITE_ROLES]);
  if (!access.ok) return access.response;
  // PR-6: retrying an attempt re-calls the image provider — paid action in local mode.
  const paidGate = await paidGateResponse(requestId);
  if (paidGate) return paidGate;

  const repo = new GenerationRepository(prisma);
  try {
    const { attempt, outbox } = await repo.retryAttempt(
      workspaceId,
      attemptId,
      access.session.userId,
    );
    await enqueueGenerationFromOutbox(outbox);
    return NextResponse.json(
      {
        attempt: {
          id: attempt.id,
          attemptNo: attempt.attemptNo,
          status: attempt.status,
          itemId: attempt.itemId,
        },
      },
      { status: 201, headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof GenerationNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof GenerationConflictError) {
      return NextResponse.json(makeApiError('CONFLICT', err.message, requestId), {
        status: 409,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof CreditInsufficientError) {
      return NextResponse.json(makeApiError('INSUFFICIENT_CREDITS', err.message, requestId), {
        status: 402,
        headers: { 'x-request-id': requestId },
      });
    }
    throw err;
  }
}
