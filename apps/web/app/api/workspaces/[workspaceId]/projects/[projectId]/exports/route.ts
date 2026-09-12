import { NextResponse } from 'next/server';
import { CreateExportRequestSchema, makeApiError } from '@studio/contracts';
import {
  QA_EXPORT_ROLES,
  assertExportAllowed,
  buildExportImagePath,
  type ExportItemGate,
  type QaReportOverallStatus,
} from '@studio/domain';
import {
  AssetRepository,
  ExportRepository,
  OutboxRepository,
  ProjectRepository,
  QaRepository,
  exportBundleJobId,
  prisma,
  type CreateExportItemInput,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { enqueueExportFromOutbox } from '@/lib/queues';
import { serializeExportBundle } from '@/lib/qa-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, QA_EXPORT_ROLES);
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
  const parsed = CreateExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid export payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const qa = new QaRepository(prisma);
  const assets = new AssetRepository(prisma);
  const truthDoc = await prisma.productTruthDocument.findFirst({
    where: { workspaceId, projectId },
  });
  const currentTruth = truthDoc?.approvedRevisionId ?? null;
  const shotPlan = await prisma.shotPlanDocument.findFirst({
    where: { workspaceId, projectId },
  });

  const usedPaths = new Set<string>();
  const gates: ExportItemGate[] = [];
  const prepared: CreateExportItemInput[] = [];

  for (const [idx, item] of parsed.data.items.entries()) {
    const version = await assets.getVersionWithRepresentations(workspaceId, item.assetVersionId);
    if (!version) {
      return NextResponse.json(
        makeApiError('NOT_FOUND', `Asset version ${item.assetVersionId} not found`, requestId),
        { status: 404, headers: { 'x-request-id': requestId } },
      );
    }
    const asset = await assets.findById(workspaceId, version.assetId);
    if (!asset || asset.projectId !== projectId) {
      return NextResponse.json(
        makeApiError('FORBIDDEN', 'Version is not in this project', requestId),
        { status: 403, headers: { 'x-request-id': requestId } },
      );
    }

    let report = item.qaReportId
      ? await qa.getReport(workspaceId, item.qaReportId)
      : (await qa.listReportsForVersion(workspaceId, item.assetVersionId)).find(
          (r) => r.status === 'SUCCEEDED',
        );
    if (!report || report.status !== 'SUCCEEDED') {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', `No SUCCEEDED QA report for ${item.assetVersionId}`, requestId),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
    const slot = item.slot ?? report.slot ?? 'MAIN';
    const findings = qa.domainFindings(report.findings);
    const truthRevisionId = report.truthRevisionId ?? currentTruth;
    if (!truthRevisionId) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', 'Export requires a Truth revision', requestId),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
    const effective = await qa.resolveEffectiveApproval({
      workspaceId,
      assetVersionId: item.assetVersionId,
      qaReportId: report.id,
      truthRevisionId,
      shotBriefRevisionId: shotPlan?.approvedRevisionId ?? report.shotBriefId,
      inputFingerprint: report.inputFingerprint,
      overallStatus: (report.overallStatus ?? 'REVIEW') as QaReportOverallStatus,
      findings,
    });
    gates.push({
      slot,
      overallStatus: (report.overallStatus ?? 'REVIEW') as QaReportOverallStatus,
      findings,
      effective,
    });
    const path = buildExportImagePath({
      sku: project.sku,
      marketplaceCode: parsed.data.marketplaceCode ?? project.marketplace,
      slot,
      variantCode: item.variantCode ?? 'BASE',
      outputIndex: idx + 1,
      versionNumber: version.versionNumber,
      usedPaths,
    });
    const mime = version.mime || 'image/png';
    prepared.push({
      assetVersionId: item.assetVersionId,
      qaReportId: report.id,
      approvalId: effective?.id ?? '',
      slot,
      variantCode: item.variantCode ?? 'BASE',
      path,
      sha256: version.sha256,
      bytes: version.byteSize,
      mime,
      outputIndex: idx,
    });
  }

  const gate = assertExportAllowed(gates);
  if (!gate.ok) {
    return NextResponse.json(makeApiError('EXPORT_BLOCKED', gate.reason, requestId, { slot: gate.slot }), {
      status: 409,
      headers: { 'x-request-id': requestId },
    });
  }

  const outboxRepo = new OutboxRepository(prisma);
  const exports = new ExportRepository(prisma);
  const { bundle, outbox } = await prisma.$transaction(async (tx) => {
    const b = await exports.createQueued({
      workspaceId,
      projectId,
      sku: project.sku,
      marketplaceCode: parsed.data.marketplaceCode ?? project.marketplace,
      truthRevisionId: currentTruth,
      rulePackKey: 'amazon-main-us-v1',
      rulePackVersion: 1,
      createdByUserId: access.session.userId,
      items: prepared,
    }, tx);
    const ob = await outboxRepo.createPending(tx, {
      workspaceId,
      aggregateType: 'ExportBundle',
      aggregateId: b.id,
      jobName: 'export-bundle',
      jobId: exportBundleJobId(b.id),
      payload: { workspaceId, bundleId: b.id },
    });
    return { bundle: b, outbox: ob };
  });

  await enqueueExportFromOutbox(outbox);
  const refreshed = await exports.getBundle(workspaceId, bundle.id);
  return NextResponse.json(serializeExportBundle(refreshed!), {
    status: 201,
    headers: { 'x-request-id': requestId },
  });
}
