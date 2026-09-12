import { NextResponse } from 'next/server';
import { ApproveShotPlanRequestSchema, makeApiError } from '@studio/contracts';
import { SHOT_PLAN_APPROVE_ROLES } from '@studio/domain';
import {
  prisma,
  ProjectRepository,
  ShotPlanRepository,
  ShotPlanConflictError,
  ShotPlanValidationError,
  ShotPlanForbiddenError,
  ShotPlanNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeShotPlan } from '@/lib/shot-plan-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

/** Atomic approve — same structure as Truth Pack approve (W2-06). */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, SHOT_PLAN_APPROVE_ROLES);
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

  const parsed = ApproveShotPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid approve payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const plans = new ShotPlanRepository(prisma);
  try {
    await plans.approveRevision(
      workspaceId,
      projectId,
      parsed.data.revisionId,
      access.session.userId,
    );
  } catch (err) {
    if (err instanceof ShotPlanNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof ShotPlanForbiddenError) {
      return NextResponse.json(makeApiError('FORBIDDEN', err.message, requestId), {
        status: 403,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof ShotPlanConflictError) {
      return NextResponse.json(makeApiError('CONFLICT', err.message, requestId), {
        status: 409,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof ShotPlanValidationError) {
      return NextResponse.json(makeApiError('VALIDATION_ERROR', err.message, requestId), {
        status: 400,
        headers: { 'x-request-id': requestId },
      });
    }
    throw err;
  }

  const refreshedDoc = await plans.getDocument(workspaceId, projectId);
  const approved = await plans.getRevisionWithBriefs(workspaceId, parsed.data.revisionId);

  return NextResponse.json(
    serializeShotPlan({
      documentId: refreshedDoc!.id,
      projectId,
      workspaceId,
      currentRevisionId: refreshedDoc!.currentRevisionId,
      approvedRevisionId: refreshedDoc!.approvedRevisionId,
      revision: approved,
    }),
    { headers: { 'x-request-id': requestId } },
  );
}
