import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { VARIANT_ADMIN_ROLES } from '@studio/domain';
import { prisma, newId } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string }> };

/** List recent generation attempts / QA / export / variant jobs for ops. */
export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...VARIANT_ADMIN_ROLES]);
  if (!access.ok) return access.response;

  const [attempts, qaReports, exports, variantRuns, outbox] = await Promise.all([
    prisma.generationAttempt.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        errorClass: true,
        errorMessage: true,
        progress: true,
        updatedAt: true,
        itemId: true,
      },
    }),
    prisma.qaReport.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, status: true, overallStatus: true, slot: true, createdAt: true },
    }),
    prisma.exportBundle.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, status: true, sku: true, createdAt: true, completedAt: true },
    }),
    prisma.variantRun.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, status: true, projectId: true, createdAt: true, completedAt: true },
    }),
    prisma.outboxMessage.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        jobName: true,
        jobId: true,
        status: true,
        createdAt: true,
        publishedAt: true,
      },
    }),
  ]);

  return NextResponse.json(
    {
      generationAttempts: attempts.map((a) => ({
        ...a,
        updatedAt: a.updatedAt.toISOString(),
      })),
      qaReports: qaReports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      exportBundles: exports.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        completedAt: e.completedAt?.toISOString() ?? null,
      })),
      variantRuns: variantRuns.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
      outbox: outbox.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
        publishedAt: o.publishedAt?.toISOString() ?? null,
      })),
    },
    { headers: { 'x-request-id': requestId } },
  );
}

/** Optional redispatch: re-queue a pending/failed outbox row (OWNER/ADMIN + audit). */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...VARIANT_ADMIN_ROLES]);
  if (!access.ok) return access.response;

  let body: { outboxId?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }
  if (!body.outboxId) {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'outboxId required', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }
  const row = await prisma.outboxMessage.findFirst({
    where: { id: body.outboxId, workspaceId },
  });
  if (!row) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Outbox row not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  await prisma.outboxMessage.update({
    where: { id: row.id },
    data: { status: 'PENDING', publishedAt: null },
  });
  await prisma.auditEvent.create({
    data: {
      id: newId(),
      workspaceId,
      actorUserId: access.session.userId,
      action: 'admin.jobs.redispatch',
      subjectType: 'outbox_message',
      subjectId: row.id,
      metadataJson: { jobName: row.jobName, jobId: row.jobId },
    },
  });
  return NextResponse.json(
    { ok: true, outboxId: row.id, status: 'PENDING' },
    { headers: { 'x-request-id': requestId } },
  );
}
