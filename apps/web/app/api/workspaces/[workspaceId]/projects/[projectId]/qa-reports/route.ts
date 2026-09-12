import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { ProjectRepository, QaRepository, prisma } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeApproval, serializeQaReport } from '@/lib/qa-serialize';

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

  const qa = new QaRepository(prisma);
  const reports = await qa.listReportsForProject(workspaceId, projectId);
  const approvals = await prisma.approval.findMany({
    where: { workspaceId, projectId },
    orderBy: { decidedAt: 'asc' },
  });
  return NextResponse.json(
    {
      items: reports.map(serializeQaReport),
      approvals: approvals.map(serializeApproval),
    },
    { headers: { 'x-request-id': requestId } },
  );
}
