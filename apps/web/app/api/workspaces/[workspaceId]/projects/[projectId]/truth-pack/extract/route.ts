import { NextResponse } from 'next/server';
import { ExtractTruthRequestSchema, makeApiError } from '@studio/contracts';
import { FakeVisionProvider } from '@studio/providers';
import {
  prisma,
  ProjectRepository,
  TruthPackRepository,
  AssetRepository,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeTruthPack } from '@/lib/truth-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

/**
 * W2-05: Vision fact extraction via Fake Provider only (W0-02 BLOCKED_EXTERNAL).
 * Never calls real provider APIs / never reads API keys.
 */
export async function POST(request: Request, context: Ctx) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const parsed = ExtractTruthRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid extract payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const assets = new AssetRepository(prisma);
  for (const versionId of parsed.data.assetVersionIds) {
    const v = await assets.getVersionWithRepresentations(workspaceId, versionId);
    if (!v) {
      return NextResponse.json(
        makeApiError('NOT_FOUND', `Asset version not in workspace: ${versionId}`, requestId),
        { status: 404, headers: { 'x-request-id': requestId } },
      );
    }
  }

  const vision = new FakeVisionProvider();
  const extracted = await vision.extractFacts({
    sku: project.sku,
    category: project.category ?? undefined,
    marketplace: project.marketplace,
    assetVersionIds: parsed.data.assetVersionIds,
    hints: project.name ? [`brand:${project.name.split(' ')[0]}`] : undefined,
  });

  const truth = new TruthPackRepository(prisma);
  const { document, revision } = await truth.saveNewRevision({
    workspaceId,
    projectId,
    createdByUserId: access.session.userId,
    facts: extracted.facts.map((f) => ({
      key: f.key,
      value: f.value,
      confidence: f.confidence,
      status: 'EXTRACTED',
      evidenceAssetVersionIds: f.evidenceAssetVersionIds,
    })),
    locks: extracted.locks,
    allowedChanges: extracted.allowedChanges,
  });

  return NextResponse.json(
    {
      provider: extracted.provider,
      modelId: extracted.modelId,
      latencyMs: extracted.latencyMs,
      pack: serializeTruthPack({
        documentId: document.id,
        projectId,
        currentRevisionId: document.currentRevisionId,
        approvedRevisionId: document.approvedRevisionId,
        revision,
      }),
    },
    { status: 201, headers: { 'x-request-id': requestId } },
  );
}
