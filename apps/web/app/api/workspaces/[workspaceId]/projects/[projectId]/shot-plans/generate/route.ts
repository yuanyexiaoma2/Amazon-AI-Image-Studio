import { NextResponse } from 'next/server';
import { GenerateShotPlanRequestSchema, makeApiError } from '@studio/contracts';
import { SHOT_PLAN_WRITE_ROLES } from '@studio/domain';
import { createShotPlanProvider, PlannerProviderError } from '@studio/providers';
import {
  prisma,
  ProjectRepository,
  ShotPlanRepository,
  TruthPackRepository,
  ShotPlanConflictError,
  ShotPlanValidationError,
  ShotPlanNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeShotPlan } from '@/lib/shot-plan-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

/**
 * W3-02: AI Shot Plan draft. Planner selected via PLANNER_PROVIDER env
 * (fake default; kie = real LLM via kie.ai chat completions, V2).
 * Requires an approved Truth Pack revision; new revision FK's that truth revision.
 * V2: when the workspace has autoApproveGates on and the request sets
 * autoApprove, the new revision is approved inline (audit actor = requester).
 */
export async function POST(request: Request, context: Ctx) {
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

  let body: unknown = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
        status: 400,
        headers: { 'x-request-id': requestId },
      });
    }
  }

  const parsed = GenerateShotPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid generate payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const plans = new ShotPlanRepository(prisma);
  const truth = new TruthPackRepository(prisma);

  try {
    const { truthRevisionId } = await plans.requireApprovedTruthRevision(
      workspaceId,
      projectId,
      parsed.data.truthRevisionId,
    );

    const truthRev = await truth.getRevisionWithDetails(workspaceId, truthRevisionId);
    const confirmedFacts =
      truthRev?.facts
        .filter((f) => f.status === 'CONFIRMED' || f.status === 'LOCKED')
        .map((f) => ({ key: f.key, value: f.valueJson })) ?? [];

    const planner = createShotPlanProvider();
    const drafted = await planner.draftPlan({
      sku: project.sku,
      category: project.category ?? undefined,
      marketplace: project.marketplace,
      confirmedFacts,
      includePackage: parsed.data.includePackage,
      intent: parsed.data.intent,
    });

    const { document, revision } = await plans.saveNewRevision({
      workspaceId,
      projectId,
      createdByUserId: access.session.userId,
      actorUserId: access.session.userId,
      truthRevisionId,
      briefs: drafted.briefs.map((b) => ({
        slot: b.slot,
        purpose: b.purpose,
        orderIndex: b.orderIndex,
        copy: b.copy,
        must: b.must,
        mustNot: b.mustNot,
        qaPolicy: b.qaPolicy,
        aspectRatio: b.aspectRatio,
        targetPixels: b.targetPixels,
        referencedAssetVersionIds: b.referencedAssetVersionIds ?? [],
      })),
      readyForReview: true,
      provider: drafted.provider,
      modelId: drafted.modelId,
      auditAction: 'shot_plan.generated',
    });

    // V2 auto-approve gate: workspace-level switch (set by OWNER/ADMIN);
    // approval stays audited with the requester as actor.
    let autoApproved = false;
    if (parsed.data.autoApprove) {
      const workspace = await prisma.workspace.findFirst({
        where: { id: workspaceId, deletedAt: null },
        select: { autoApproveGates: true },
      });
      if (workspace?.autoApproveGates) {
        await plans.approveRevision(
          workspaceId,
          projectId,
          revision.id,
          access.session.userId,
        );
        autoApproved = true;
      }
    }

    const refreshedDoc = autoApproved
      ? await plans.getDocument(workspaceId, projectId)
      : document;
    const finalRevision = autoApproved
      ? ((await plans.getRevisionWithBriefs(workspaceId, revision.id)) ?? revision)
      : revision;

    return NextResponse.json(
      {
        provider: drafted.provider,
        modelId: drafted.modelId,
        latencyMs: drafted.latencyMs,
        autoApproved,
        plan: serializeShotPlan({
          documentId: refreshedDoc!.id,
          projectId,
          workspaceId,
          currentRevisionId: refreshedDoc!.currentRevisionId,
          approvedRevisionId: refreshedDoc!.approvedRevisionId,
          revision: finalRevision,
        }),
      },
      { status: 201, headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof PlannerProviderError) {
      const status = err.errorClass === 'AUTH' ? 502 : err.errorClass === 'VALIDATION' ? 502 : 503;
      return NextResponse.json(
        makeApiError(
          err.errorClass === 'AUTH' ? 'PLANNER_AUTH_FAILED' : 'PLANNER_UNAVAILABLE',
          err.message,
          requestId,
          { plannerErrorClass: err.errorClass },
        ),
        { status, headers: { 'x-request-id': requestId } },
      );
    }
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
