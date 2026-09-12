import { NextResponse } from 'next/server';
import { VariantExportRequestSchema, makeApiError } from '@studio/contracts';
import {
  QA_EXPORT_ROLES,
  buildExportImagePath,
  buildVariantManifestEntry,
} from '@studio/domain';
import {
  AssetRepository,
  ExportRepository,
  OutboxRepository,
  ProjectRepository,
  QaRepository,
  VariantRepository,
  exportBundleJobId,
  prisma,
  type CreateExportItemInput,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { enqueueExportFromOutbox } from '@/lib/queues';
import { serializeExportBundle } from '@/lib/qa-serialize';

type Ctx = { params: Promise<{ workspaceId: string; runId: string }> };

/**
 * W7-05: export only passing (QA_PASS) variant items + variant manifest.
 * Failed / BLOCK items are filtered out. Master Approval is NOT inherited —
 * each item still needs its own effective approval when present; Fake e2e
 * may approve PASS items before calling this endpoint.
 */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, runId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, QA_EXPORT_ROLES);
  if (!access.ok) return access.response;

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
  const parsed = VariantExportRequestSchema.safeParse({
    ...(typeof body === 'object' && body ? body : {}),
    variantRunId: runId,
  });
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid variant export payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const variants = new VariantRepository(prisma);
  const run = await variants.getRun(workspaceId, runId);
  if (!run) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Variant run not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const projects = new ProjectRepository(prisma);
  const project = await projects.findById(workspaceId, run.projectId);
  if (!project) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const candidates = await variants.listPassingExportCandidates(
    workspaceId,
    runId,
    parsed.data.allowReview,
  );
  const filteredOut: Array<{ id: string; variantId: string; slot: string; status: string }> = run.items
    .filter((it) => !candidates.some((c) => c.id === it.id))
    .map((it) => ({
      id: it.id,
      variantId: it.variantId,
      slot: it.slot,
      status: String(it.status),
    }));

  const qa = new QaRepository(prisma);
  const assets = new AssetRepository(prisma);
  const usedPaths = new Set<string>();
  const prepared: CreateExportItemInput[] = [];
  const manifestEntries: Record<string, unknown>[] = [];

  for (const it of candidates) {
    if (!it.selectedAssetVersionId || !it.qaReportId) continue;
    const version = await assets.getVersionWithRepresentations(workspaceId, it.selectedAssetVersionId);
    if (!version) continue;
    const report = await qa.getReport(workspaceId, it.qaReportId);
    if (!report) continue;
    const approvals = await qa.listApprovalsForVersion(workspaceId, it.selectedAssetVersionId);
    const effective = approvals.find((a) => a.decision === 'APPROVE' || a.decision === 'OVERRIDE_BLOCK');
    if (!effective) {
      filteredOut.push({
        id: it.id,
        variantId: it.variantId,
        slot: it.slot,
        status: 'NO_APPROVAL',
      });
      continue;
    }

    const variantCode = (it as { variant?: { code: string } }).variant?.code ?? 'VAR';
    const path = buildExportImagePath({
      sku: project.sku,
      marketplaceCode: project.marketplace,
      slot: it.slot,
      variantCode,
      outputIndex: it.outputIndex,
      versionNumber: version.versionNumber,
      ext: version.mime === 'image/jpeg' ? 'jpg' : 'png',
    });
    if (usedPaths.has(path)) continue;
    usedPaths.add(path);
    const rep =
      version.representations.find((r) => r.kind === 'NORMALIZED_PNG') ??
      version.representations.find((r) => r.kind === 'ORIGINAL_UPLOAD') ??
      version.representations[0];
    prepared.push({
      assetVersionId: version.id,
      qaReportId: report.id,
      approvalId: effective.id,
      slot: it.slot,
      variantCode,
      path,
      sha256: rep?.sha256 ?? version.sha256,
      bytes: rep?.bytes ?? version.byteSize,
      mime: version.mime,
      outputIndex: it.outputIndex,
    });
    manifestEntries.push(
      buildVariantManifestEntry({
        variantCode,
        slot: it.slot,
        outputIndex: it.outputIndex,
        assetVersionId: version.id,
        qaReportId: report.id,
        status: it.status as 'QA_PASS',
        path,
      }),
    );
  }

  if (prepared.length === 0) {
    return NextResponse.json(
      makeApiError(
        'EXPORT_EMPTY',
        'No approved passing variant items to export',
        requestId,
        { filteredOut, manifest: { variantRunId: runId, items: manifestEntries } },
      ),
      { status: 409, headers: { 'x-request-id': requestId } },
    );
  }

  const exports = new ExportRepository(prisma);
  const outboxRepo = new OutboxRepository(prisma);
  const truthDoc = await prisma.productTruthDocument.findFirst({
    where: { workspaceId, projectId: run.projectId },
  });
  const { bundle, outbox } = await prisma.$transaction(async (tx) => {
    const b = await exports.createQueued(
      {
        workspaceId,
        projectId: run.projectId,
        sku: project.sku,
        marketplaceCode: project.marketplace,
        truthRevisionId: truthDoc?.approvedRevisionId ?? null,
        rulePackKey: 'amazon-main-us-v1',
        rulePackVersion: 1,
        createdByUserId: access.session.userId,
        items: prepared,
      },
      tx,
    );
    await tx.exportBundle.update({
      where: { id: b.id },
      data: {
        manifestJson: JSON.parse(
          JSON.stringify({
            variantRunId: runId,
            onlyPassing: parsed.data.onlyPassing,
            items: manifestEntries,
            filteredOut,
            schemaVersion: 1,
          }),
        ),
      },
    });
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
  return NextResponse.json(
    {
      ...serializeExportBundle(refreshed!),
      variantManifest: { variantRunId: runId, items: manifestEntries, filteredOut },
    },
    { status: 201, headers: { 'x-request-id': requestId } },
  );
}
