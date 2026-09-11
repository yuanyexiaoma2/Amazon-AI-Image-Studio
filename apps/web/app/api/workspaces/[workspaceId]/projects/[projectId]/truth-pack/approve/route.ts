import { NextResponse } from 'next/server';
import { ApproveTruthRequestSchema, makeApiError } from '@studio/contracts';
import { canApproveTruthRevision, type FactStatus } from '@studio/domain';
import { prisma, ProjectRepository, TruthPackRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeTruthPack } from '@/lib/truth-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

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

  const parsed = ApproveTruthRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid approve payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const truth = new TruthPackRepository(prisma);
  const revision = await truth.getRevisionWithDetails(workspaceId, parsed.data.revisionId);
  if (!revision) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Revision not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
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

  await truth.approveRevision(workspaceId, parsed.data.revisionId, access.session.userId);
  const document = await truth.getDocument(workspaceId, projectId);
  const approved = await truth.getRevisionWithDetails(workspaceId, parsed.data.revisionId);

  return NextResponse.json(
    serializeTruthPack({
      documentId: document!.id,
      projectId,
      currentRevisionId: document!.currentRevisionId,
      approvedRevisionId: document!.approvedRevisionId,
      revision: approved,
    }),
    { headers: { 'x-request-id': requestId } },
  );
}
