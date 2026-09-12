import { NextResponse } from 'next/server';
import { CreateApprovalRequestSchema, makeApiError } from '@studio/contracts';
import { validateApprovalDecision, type QaReportOverallStatus } from '@studio/domain';
import {
  AssetRepository,
  QaRepository,
  newId,
  prisma,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeApproval } from '@/lib/qa-serialize';

type Ctx = { params: Promise<{ workspaceId: string; versionId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, versionId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;
  const qa = new QaRepository(prisma);
  const rows = await qa.listApprovalsForVersion(workspaceId, versionId);
  return NextResponse.json({ items: rows.map(serializeApproval) }, {
    headers: { 'x-request-id': requestId },
  });
}

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, versionId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }
  const parsed = CreateApprovalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid approval payload', requestId, parsed.error.flatten()),
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

  const qa = new QaRepository(prisma);
  const report = await qa.getReport(workspaceId, parsed.data.qaReportId);
  if (!report || report.assetVersionId !== versionId) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'QA report not found for version', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  if (report.status !== 'SUCCEEDED' || !report.overallStatus) {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'QA report is not SUCCEEDED', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const findings = qa.domainFindings(report.findings);
  const gate = validateApprovalDecision({
    decision: parsed.data.decision,
    role: access.role,
    overallStatus: report.overallStatus as QaReportOverallStatus,
    findings,
    reason: parsed.data.reason,
  });
  if (!gate.ok) {
    const status = gate.code === 'FORBIDDEN' ? 403 : gate.code === 'CONFLICT' ? 409 : 400;
    return NextResponse.json(makeApiError(gate.code, gate.reason, requestId), {
      status,
      headers: { 'x-request-id': requestId },
    });
  }

  const truthDoc = await prisma.productTruthDocument.findFirst({
    where: { workspaceId, projectId: asset.projectId },
  });
  const truthRevisionId = report.truthRevisionId ?? truthDoc?.approvedRevisionId;
  if (!truthRevisionId) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Approval requires a Truth revision reference', requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const shotPlan = await prisma.shotPlanDocument.findFirst({
    where: { workspaceId, projectId: asset.projectId },
  });

  const row = await qa.appendApproval({
    workspaceId,
    projectId: asset.projectId,
    assetVersionId: versionId,
    qaReportId: report.id,
    truthRevisionId,
    shotBriefRevisionId: parsed.data.shotBriefRevisionId ?? shotPlan?.approvedRevisionId ?? null,
    workflowRevisionId: parsed.data.workflowRevisionId ?? report.workflowRevisionId,
    inputFingerprint: report.inputFingerprint,
    decision: parsed.data.decision,
    actorUserId: access.session.userId,
    actorRole: access.role,
    reason: parsed.data.reason ?? null,
  });

  await prisma.auditEvent.create({
    data: {
      id: newId(),
      workspaceId,
      actorUserId: access.session.userId,
      action: `approval.${parsed.data.decision.toLowerCase()}`,
      subjectType: 'QaReport',
      subjectId: report.id,
      metadataJson: { approvalId: row.id, assetVersionId: versionId },
    },
  });
  return NextResponse.json(serializeApproval(row), {
    status: 201,
    headers: { 'x-request-id': requestId },
  });
}
