import { NextResponse } from 'next/server';
import { prisma, GenerationRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeRun } from '@/lib/generation-serialize';
import { makeApiError } from '@studio/contracts';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId } });
  if (!project) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const repo = new GenerationRepository(prisma);
  const rows = await repo.listRunsForProject(workspaceId, projectId, 20);
  return NextResponse.json(
    { runs: rows.map((r) => serializeRun(r as never)) },
    { headers: { 'x-request-id': requestId } },
  );
}
