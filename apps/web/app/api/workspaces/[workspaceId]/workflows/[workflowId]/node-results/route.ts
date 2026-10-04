import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, NodeResultRepository, WorkflowRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { computeDraftNodeFingerprints } from '@/lib/node-fingerprint';
import { requireWorkspaceMember } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string; workflowId: string }> };

/**
 * GET /workspaces/{ws}/workflows/{wf}/node-results?revisionId=…
 * Returns `{ results: { [nodeId]: imageAssetVersionIds[] }, stale: { [nodeId]: boolean } }`
 * for SUCCEEDED node results of one workflow revision (defaults to the
 * workflow's currentRevisionId — the revision the latest run snapshotted).
 * Drives generate-node thumbnails on the canvas.
 *
 * stale 判定：用当前 draft 图重算节点 inputFingerprint，与该节点 SUCCEEDED
 * 结果行存的 inputFingerprint 比对；不一致或节点已从 draft 删除 → stale。
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
    return NextResponse.json(
      { results: {}, stale: {} },
      { headers: { 'x-request-id': requestId } },
    );
  }

  const nodeResults = new NodeResultRepository(prisma);
  const rows = await nodeResults.listForRevision(workspaceId, revisionId);
  const results: Record<string, string[]> = {};
  for (const row of rows) {
    if (row.status !== 'SUCCEEDED') continue;
    const out = row.outputJson as { imageAssetVersionIds?: unknown } | null;
    const ids = Array.isArray(out?.imageAssetVersionIds)
      ? out.imageAssetVersionIds.filter((v): v is string => typeof v === 'string')
      : [];
    if (ids.length > 0) results[row.nodeId] = ids;
  }

  const draftGraph = wf.draft ? workflows.parseGraph(wf.draft) : null;
  const draftFingerprints = draftGraph
    ? await computeDraftNodeFingerprints(prisma, workspaceId, draftGraph)
    : {};
  const stale: Record<string, boolean> = {};
  for (const row of rows) {
    if (row.status !== 'SUCCEEDED') continue;
    const current = draftFingerprints[row.nodeId];
    // 节点已从 draft 删除（或无 draft）→ stale；指纹缺失则无法判定，按不 stale。
    stale[row.nodeId] =
      current === undefined ? true : row.inputFingerprint !== null && row.inputFingerprint !== current;
  }

  return NextResponse.json({ results, stale }, { headers: { 'x-request-id': requestId } });
}
