import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { RUN_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  GenerationRepository,
  GenerationNotFoundError,
  GenerationConflictError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeRun } from '@/lib/generation-serialize';

type Ctx = { params: Promise<{ workspaceId: string; runId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, runId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...RUN_WRITE_ROLES]);
  if (!access.ok) return access.response;

  const repo = new GenerationRepository(prisma);
  try {
    const run = await repo.requestCancel(workspaceId, runId);
    return NextResponse.json(serializeRun(run), {
      headers: { 'x-request-id': requestId },
    });
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
    throw err;
  }
}
