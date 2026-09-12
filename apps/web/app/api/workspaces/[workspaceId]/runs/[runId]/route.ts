import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, GenerationRepository, GenerationNotFoundError } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeRun } from '@/lib/generation-serialize';

type Ctx = { params: Promise<{ workspaceId: string; runId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, runId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const repo = new GenerationRepository(prisma);
  const run = await repo.getRun(workspaceId, runId);
  if (!run) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Run not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  return NextResponse.json(serializeRun(run), {
    headers: { 'x-request-id': requestId },
  });
}
