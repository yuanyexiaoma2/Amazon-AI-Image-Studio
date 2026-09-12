import { NextResponse } from 'next/server';
import { SaveShotPlanRequestSchema, makeApiError } from '@studio/contracts';
import { SHOT_PLAN_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  ProjectRepository,
  ShotPlanRepository,
  ShotPlanConflictError,
  ShotPlanValidationError,
  ShotPlanNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles, requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeShotPlan } from '@/lib/shot-plan-serialize';

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

  const plans = new ShotPlanRepository(prisma);
  const document = await plans.ensureDocument(workspaceId, projectId);
  const revision = document.currentRevisionId
    ? await plans.getRevisionWithBriefs(workspaceId, document.currentRevisionId)
    : null;

  return NextResponse.json(
    serializeShotPlan({
      documentId: document.id,
      projectId,
      workspaceId,
      currentRevisionId: document.currentRevisionId,
      approvedRevisionId: document.approvedRevisionId,
      revision,
    }),
    { headers: { 'x-request-id': requestId } },
  );
}

/** Human edit → new revision (default PENDING_REVIEW), same pattern as Truth PUT. */
export async function PUT(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, SHOT_PLAN_WRITE_ROLES);
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

  const parsed = SaveShotPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid shot plan payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const plans = new ShotPlanRepository(prisma);
  try {
    const { truthRevisionId } = await plans.requireApprovedTruthRevision(
      workspaceId,
      projectId,
      parsed.data.truthRevisionId,
    );
    const { document, revision } = await plans.saveNewRevision({
      workspaceId,
      projectId,
      createdByUserId: access.session.userId,
      actorUserId: access.session.userId,
      truthRevisionId,
      briefs: parsed.data.briefs,
      readyForReview: parsed.data.readyForReview,
      auditAction: 'shot_plan.human_edit',
    });
    return NextResponse.json(
      serializeShotPlan({
        documentId: document.id,
        projectId,
        workspaceId,
        currentRevisionId: document.currentRevisionId,
        approvedRevisionId: document.approvedRevisionId,
        revision,
      }),
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof ShotPlanNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
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
}
