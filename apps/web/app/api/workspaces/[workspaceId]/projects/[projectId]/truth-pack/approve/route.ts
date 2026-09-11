import { NextResponse } from 'next/server';
import { ApproveTruthRequestSchema, makeApiError } from '@studio/contracts';
import { TRUTH_APPROVE_ROLES } from '@studio/domain';
import {
  prisma,
  ProjectRepository,
  TruthPackRepository,
  TruthPackConflictError,
  TruthPackValidationError,
  TruthPackForbiddenError,
  TruthPackNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeTruthPack } from '@/lib/truth-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, TRUTH_APPROVE_ROLES);
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
  try {
    await truth.approveRevision(
      workspaceId,
      projectId,
      parsed.data.revisionId,
      access.session.userId,
    );
  } catch (err) {
    if (err instanceof TruthPackNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof TruthPackForbiddenError) {
      return NextResponse.json(makeApiError('FORBIDDEN', err.message, requestId), {
        status: 403,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof TruthPackConflictError) {
      return NextResponse.json(makeApiError('CONFLICT', err.message, requestId), {
        status: 409,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof TruthPackValidationError) {
      return NextResponse.json(makeApiError('VALIDATION_ERROR', err.message, requestId), {
        status: 400,
        headers: { 'x-request-id': requestId },
      });
    }
    throw err;
  }

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
