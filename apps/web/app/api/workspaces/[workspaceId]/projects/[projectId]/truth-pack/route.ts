import { NextResponse } from 'next/server';
import { SaveTruthPackRequestSchema, makeApiError } from '@studio/contracts';
import { prisma, ProjectRepository, TruthPackRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember, requireWorkspaceRoles } from '@/lib/workspace-access';
import { TRUTH_WRITE_ROLES } from '@studio/domain';
import { serializeTruthPack } from '@/lib/truth-serialize';

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

  const truth = new TruthPackRepository(prisma);
  const document = await truth.ensureDocument(workspaceId, projectId);
  const revision = document.currentRevisionId
    ? await truth.getRevisionWithDetails(workspaceId, document.currentRevisionId)
    : null;

  return NextResponse.json(
    serializeTruthPack({
      documentId: document.id,
      projectId,
      currentRevisionId: document.currentRevisionId,
      approvedRevisionId: document.approvedRevisionId,
      revision,
    }),
    { headers: { 'x-request-id': requestId } },
  );
}

export async function PUT(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, TRUTH_WRITE_ROLES);
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

  const parsed = SaveTruthPackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid truth pack', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const truth = new TruthPackRepository(prisma);
  const { document, revision } = await truth.saveNewRevision({
    workspaceId,
    projectId,
    createdByUserId: access.session.userId,
    facts: parsed.data.facts.map((f) => ({
      key: f.key,
      value: f.value,
      confidence: f.confidence,
      status: f.status,
      evidenceAssetVersionIds: f.evidenceAssetVersionIds,
    })),
    locks: parsed.data.locks,
    allowedChanges: parsed.data.allowedChanges,
  });

  return NextResponse.json(
    serializeTruthPack({
      documentId: document.id,
      projectId,
      currentRevisionId: document.currentRevisionId,
      approvedRevisionId: document.approvedRevisionId,
      revision,
    }),
    { headers: { 'x-request-id': requestId } },
  );
}
