import { NextResponse } from 'next/server';
import {
  MaterializeShotPlanRequestSchema,
  makeApiError,
} from '@studio/contracts';
import {
  WORKFLOW_WRITE_ROLES,
  collectReferencedAssetVersionIds,
  materializeShotPlanToGraph,
  type ShotPlanCanvasPayload,
} from '@studio/domain';
import {
  prisma,
  ProjectRepository,
  ShotPlanRepository,
  ShotPlanValidationError,
  AssetRepository,
  WorkflowRepository,
  WorkflowValidationError,
  WorkflowNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeShotPlan } from '@/lib/shot-plan-serialize';
import { serializeWorkflowDraft } from '@/lib/workflow-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

/**
 * W3-08: POST materialize approved Shot Plan → workflow graph.
 * Consumes W3-A canvasPayload shape unchanged; app-layer validates referencedAssetVersionIds.
 */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...WORKFLOW_WRITE_ROLES]);
  if (!access.ok) return access.response;

  const projects = new ProjectRepository(prisma);
  const project = await projects.findById(workspaceId, projectId);
  if (!project) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const parsed = MaterializeShotPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid materialize payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const plans = new ShotPlanRepository(prisma);
  const doc = await plans.getDocument(workspaceId, projectId);
  if (!doc?.approvedRevisionId) {
    return NextResponse.json(
      makeApiError(
        'VALIDATION_ERROR',
        'Cannot materialize without an approved Shot Plan revision',
        requestId,
      ),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const revisionId = parsed.data.planRevisionId ?? doc.approvedRevisionId;
  if (parsed.data.planRevisionId && parsed.data.planRevisionId !== doc.approvedRevisionId) {
    return NextResponse.json(
      makeApiError(
        'VALIDATION_ERROR',
        'planRevisionId must be the project approved Shot Plan revision',
        requestId,
      ),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const revision = await plans.getRevisionWithBriefs(workspaceId, revisionId);
  if (!revision || revision.status !== 'APPROVED') {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Shot Plan revision is not APPROVED', requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const serialized = serializeShotPlan({
    documentId: doc.id,
    projectId,
    workspaceId,
    currentRevisionId: doc.currentRevisionId,
    approvedRevisionId: doc.approvedRevisionId,
    revision,
  });
  const canvasPayload = serialized.canvasPayload as ShotPlanCanvasPayload | null;
  if (!canvasPayload) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'canvasPayload missing for approved plan', requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  // MSG-005: referencedAssetVersionIds are JSONB (no FK) — validate at app layer.
  const assetIds = collectReferencedAssetVersionIds(canvasPayload);
  const assets = new AssetRepository(prisma);
  try {
    await assets.assertVersionsInProject(workspaceId, projectId, assetIds);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid referencedAssetVersionIds';
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', message, requestId, { referencedAssetVersionIds: assetIds }),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const materialized = materializeShotPlanToGraph(canvasPayload);
  if (!materialized.ok) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', materialized.message, requestId, materialized.issues),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const workflows = new WorkflowRepository(prisma);
  const name =
    parsed.data.name ??
    `Shot Plan · ${canvasPayload.briefs.length}-image · ${revision.revision}`;

  try {
    const created = await workflows.createWithGraph({
      workspaceId,
      projectId,
      name,
      createdByUserId: access.session.userId,
      graph: materialized.graph,
    });
    if (!created.draft) {
      return NextResponse.json(makeApiError('INTERNAL_ERROR', 'Draft missing', requestId), {
        status: 500,
        headers: { 'x-request-id': requestId },
      });
    }
    return NextResponse.json(
      {
        workflow: serializeWorkflowDraft({
          workflowId: created.id,
          projectId: created.projectId,
          name: created.name,
          currentRevisionId: created.currentRevisionId,
          revisionNumber: created.draft.revisionNumber,
          graph: workflows.parseGraph(created.draft),
          updatedAt: created.draft.updatedAt,
          updatedByUserId: created.draft.updatedByUserId,
        }),
        briefCount: materialized.briefCount,
        planRevisionId: revisionId,
        planDocumentId: doc.id,
      },
      { status: 201, headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof WorkflowValidationError) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', err.message, requestId, err.details),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
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
