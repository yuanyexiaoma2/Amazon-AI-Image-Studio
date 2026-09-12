import { NextResponse } from 'next/server';
import { DispatchQaRequestSchema, makeApiError } from '@studio/contracts';
import { QA_WRITE_ROLES } from '@studio/domain';
import {
  AssetRepository,
  OutboxRepository,
  ProjectRepository,
  QaRepository,
  QaValidationError,
  prisma,
  qaEvaluateJobId,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { enqueueQaFromOutbox } from '@/lib/queues';
import { serializeQaReport } from '@/lib/qa-serialize';

type Ctx = { params: Promise<{ workspaceId: string; versionId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, versionId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, QA_WRITE_ROLES);
  if (!access.ok) return access.response;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = DispatchQaRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid QA dispatch payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const assets = new AssetRepository(prisma);
  const version = await assets.getVersionWithRepresentations(workspaceId, versionId);
  if (!version) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Asset version not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  const asset = await assets.findById(workspaceId, version.assetId);
  if (!asset) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Asset not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const projects = new ProjectRepository(prisma);
  const project = await projects.findById(workspaceId, asset.projectId);
  if (!project) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const truthDoc = await prisma.productTruthDocument.findFirst({
    where: { workspaceId, projectId: project.id },
  });
  const truthRevisionId = parsed.data.truthRevisionId ?? truthDoc?.approvedRevisionId ?? null;

  const qa = new QaRepository(prisma);
  const outboxRepo = new OutboxRepository(prisma);
  let report;
  let outbox;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const q = new QaRepository(prisma);
      const r = await q.createQueuedReport({
        workspaceId,
        projectId: project.id,
        assetVersionId: versionId,
        createdByUserId: access.session.userId,
        slot: parsed.data.slot ?? 'MAIN',
        shotBriefId: parsed.data.shotBriefId ?? null,
        truthRevisionId,
        workflowRevisionId: parsed.data.workflowRevisionId ?? null,
        policyKey: parsed.data.policyKey,
        ocrScenario: parsed.data.ocrScenario ?? null,
        visionScenario: parsed.data.visionScenario ?? null,
      }, tx);
      const jobId = qaEvaluateJobId(r.id);
      const ob = await outboxRepo.createPending(tx, {
        workspaceId,
        aggregateType: 'QaReport',
        aggregateId: r.id,
        jobName: 'qa-evaluate',
        jobId,
        payload: { workspaceId, reportId: r.id },
      });
      return { report: r, outbox: ob };
    });
    report = created.report;
    outbox = created.outbox;
  } catch (err) {
    if (err instanceof QaValidationError) {
      return NextResponse.json(makeApiError('VALIDATION_ERROR', err.message, requestId), {
        status: 400,
        headers: { 'x-request-id': requestId },
      });
    }
    throw err;
  }

  await enqueueQaFromOutbox(outbox);
  const refreshed = await qa.getReport(workspaceId, report.id);
  return NextResponse.json(serializeQaReport(refreshed!), {
    status: 201,
    headers: { 'x-request-id': requestId },
  });
}
