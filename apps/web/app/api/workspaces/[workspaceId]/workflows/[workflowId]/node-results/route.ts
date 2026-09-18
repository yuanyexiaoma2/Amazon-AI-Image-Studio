import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, NodeResultRepository, WorkflowRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string; workflowId: string }> };

/**
 * GET /workspaces/{ws}/workflows/{wf}/node-results?revisionId=…
 * Returns `{ [nodeId]: imageAssetVersionIds[] }` for SUCCEEDED node results of
 * one workflow revision (defaults to the workflow's currentRevisionId — the
 * revision the latest run snapshotted). Drives generate-node thumbnails on
 * the canvas.
 */
export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, workflowId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const workflows = new WorkflowRepository(prisma);
  const wf = await workflows.getWithDraft(workspaceId, workflowId);
  if (!wf) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Workflow not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const revisionParam = new URL(request.url).searchParams.get('revisionId');
  let revisionId = wf.currentRevisionId;
  if (revisionParam) {
    const revision = await prisma.workflowRevision.findFirst({
      where: { id: revisionParam, workflowId: wf.id, workspaceId },
      select: { id: true },
    });
    if (!revision) {
      return NextResponse.json(makeApiError('NOT_FOUND', 'Revision not found', requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    revisionId = revision.id;
  }
  if (!revisionId) {
    return NextResponse.json({}, { headers: { 'x-request-id': requestId } });
  }

  const nodeResults = new NodeResultRepository(prisma);
  const rows = await nodeResults.listForRevision(workspaceId, revisionId);
  const map: Record<string, string[]> = {};
  for (const row of rows) {
    if (row.status !== 'SUCCEEDED') continue;
    const out = row.outputJson as { imageAssetVersionIds?: unknown } | null;
    const ids = Array.isArray(out?.imageAssetVersionIds)
      ? out.imageAssetVersionIds.filter((v): v is string => typeof v === 'string')
      : [];
    if (ids.length > 0) map[row.nodeId] = ids;
  }
  return NextResponse.json(map, { headers: { 'x-request-id': requestId } });
}
