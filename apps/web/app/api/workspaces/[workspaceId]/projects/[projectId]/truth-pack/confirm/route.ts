import { NextResponse } from 'next/server';
import { ConfirmFactsRequestSchema, makeApiError } from '@studio/contracts';
import { canTransitionFact, type FactStatus } from '@studio/domain';
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

  const parsed = ConfirmFactsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid confirm payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const truth = new TruthPackRepository(prisma);
  const document = await truth.getDocument(workspaceId, projectId);
  if (!document?.currentRevisionId) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'No truth revision', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const revision = await truth.getRevisionWithDetails(workspaceId, document.currentRevisionId);
  if (!revision || revision.status === 'APPROVED') {
    return NextResponse.json(
      makeApiError('CONFLICT', 'Cannot modify approved or missing revision', requestId),
      { status: 409, headers: { 'x-request-id': requestId } },
    );
  }

  for (const u of parsed.data.updates) {
    const fact = revision.facts.find((f) => f.id === u.factId);
    if (!fact) {
      return NextResponse.json(makeApiError('NOT_FOUND', `Fact ${u.factId} not in revision`, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    if (!canTransitionFact(fact.status as FactStatus, u.status as FactStatus)) {
      return NextResponse.json(
        makeApiError(
          'VALIDATION_ERROR',
          `Illegal fact transition ${fact.status} -> ${u.status} for ${fact.key}`,
          requestId,
        ),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
  }

  await truth.updateFactStatuses(
    workspaceId,
    parsed.data.updates.map((u) => ({ factId: u.factId, status: u.status })),
  );

  // Move draft to pending review when all extracteds are resolved
  const refreshed = await truth.getRevisionWithDetails(workspaceId, document.currentRevisionId);
  if (refreshed && refreshed.facts.every((f) => f.status !== 'EXTRACTED')) {
    await truth.setRevisionStatus(workspaceId, refreshed.id, 'PENDING_REVIEW');
  }

  const finalRev = await truth.getRevisionWithDetails(workspaceId, document.currentRevisionId);
  const doc = await truth.getDocument(workspaceId, projectId);

  return NextResponse.json(
    serializeTruthPack({
      documentId: doc!.id,
      projectId,
      currentRevisionId: doc!.currentRevisionId,
      approvedRevisionId: doc!.approvedRevisionId,
      revision: finalRev,
    }),
    { headers: { 'x-request-id': requestId } },
  );
}
