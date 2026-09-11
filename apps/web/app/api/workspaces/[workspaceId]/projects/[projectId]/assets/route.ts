import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { AssetRepository, prisma, ProjectRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const projects = new ProjectRepository(prisma);
  const project = await projects.findById(workspaceId, projectId);
  if (!project) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const assets = new AssetRepository(prisma);
  const list = await assets.listByProject(workspaceId, projectId);
  return NextResponse.json(
    {
      items: list.map((a) => ({
        id: a.id,
        workspaceId: a.workspaceId,
        projectId: a.projectId,
        kind: a.kind,
        status: a.status,
        currentVersionId: a.currentVersionId,
        originalFilename: a.originalFilename,
        createdAt: a.createdAt.toISOString(),
      })),
    },
    { headers: { 'x-request-id': requestId } },
  );
}
