import { NextResponse } from 'next/server';
import { ApproveTruthRequestSchema, makeApiError } from '@studio/contracts';
import {
  canApproveTruthRevision,
  canRoleApproveTruth,
  type FactStatus,
} from '@studio/domain';
import { AssetRepository, prisma, ProjectRepository, TruthPackRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeTruthPack } from '@/lib/truth-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  if (!canRoleApproveTruth(access.role)) {
    return NextResponse.json(
      makeApiError('FORBIDDEN', 'Only OWNER / ADMIN / REVIEWER may approve Truth Pack', requestId),
      { status: 403, headers: { 'x-request-id': requestId } },
    );
  }

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

  const parsed = ApproveTruthRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid approve payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const truth = new TruthPackRepository(prisma);
  const document = await truth.getDocument(workspaceId, projectId);
  if (!document) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Truth document not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const revision = await truth.getRevisionWithDetails(workspaceId, parsed.data.revisionId);
  if (!revision) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Revision not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  // Must belong to current project/document
  if (revision.documentId !== document.id) {
    return NextResponse.json(
      makeApiError('FORBIDDEN', 'Revision does not belong to this project', requestId),
      { status: 403, headers: { 'x-request-id': requestId } },
    );
  }

  // Must be the current revision
  if (document.currentRevisionId !== revision.id) {
    return NextResponse.json(
      makeApiError('CONFLICT', 'Only the current revision can be approved', requestId),
      { status: 409, headers: { 'x-request-id': requestId } },
    );
  }

  if (revision.status !== 'PENDING_REVIEW') {
    return NextResponse.json(
      makeApiError(
        'CONFLICT',
        `Revision status must be PENDING_REVIEW (got ${revision.status})`,
        requestId,
      ),
      { status: 409, headers: { 'x-request-id': requestId } },
    );
  }

  // Evidence Asset Versions must belong to current project AND workspace
  const evidenceIds = new Set<string>();
  for (const fact of revision.facts) {
    const ids = fact.evidenceAssetVersionIds;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === 'string') evidenceIds.add(id);
      }
    }
  }
  if (evidenceIds.size > 0) {
    try {
      const assets = new AssetRepository(prisma);
      await assets.assertVersionsInProject(workspaceId, projectId, [...evidenceIds]);
    } catch (err) {
      return NextResponse.json(
        makeApiError(
          'FORBIDDEN',
          err instanceof Error ? err.message : 'Invalid evidence asset version',
          requestId,
        ),
        { status: 403, headers: { 'x-request-id': requestId } },
      );
    }
  }

  const gate = canApproveTruthRevision(
    revision.facts.map((f) => ({ status: f.status as FactStatus })),
  );
  if (!gate.ok) {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', gate.reason, requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  await truth.approveRevision(workspaceId, projectId, parsed.data.revisionId, access.session.userId);
  const refreshedDoc = await truth.getDocument(workspaceId, projectId);
  const approved = await truth.getRevisionWithDetails(workspaceId, parsed.data.revisionId);

  return NextResponse.json(
    serializeTruthPack({
      documentId: refreshedDoc!.id,
      projectId,
      currentRevisionId: refreshedDoc!.currentRevisionId,
      approvedRevisionId: refreshedDoc!.approvedRevisionId,
      revision: approved,
    }),
    { headers: { 'x-request-id': requestId } },
  );
}
