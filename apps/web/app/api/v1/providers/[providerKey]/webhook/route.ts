import { NextResponse } from 'next/server';
import { prisma, newId, reconcileOrphanProviderEvents } from '@studio/db';
import { FakeImageProviderAdapter, ProviderAdapterError } from '@studio/providers';
import { getOrCreateRequestId } from '@/lib/request-id';
import { makeApiError } from '@studio/contracts';

type Ctx = { params: Promise<{ providerKey: string }> };

/**
 * POST /api/v1/providers/{providerKey}/webhook
 * Raw body signature verify; provider event id idempotent (spec §12.6).
 * W5-A ride-along: early-arrival events are stored as orphans (processedAt=null)
 * and reconciled when the matching ProviderSubmission appears.
 */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { providerKey } = await context.params;

  if (providerKey !== 'fake') {
    return NextResponse.json(
      makeApiError('NOT_FOUND', `Unknown provider ${providerKey}`, requestId),
      { status: 404, headers: { 'x-request-id': requestId } },
    );
  }

  const raw = new Uint8Array(await request.arrayBuffer());
  const adapter = new FakeImageProviderAdapter();

  let verified;
  try {
    verified = await adapter.verifyWebhook!(request.headers, raw);
  } catch (err) {
    if (err instanceof ProviderAdapterError) {
      const status = err.errorClass === 'AUTH' ? 401 : 400;
      return NextResponse.json(makeApiError(err.errorClass, err.message, requestId), {
        status,
        headers: { 'x-request-id': requestId },
      });
    }
    throw err;
  }

  const existing = await prisma.providerEvent.findUnique({
    where: {
      provider_externalEventId: {
        provider: providerKey,
        externalEventId: verified.providerEventId,
      },
    },
  });
  // Only skip as duplicate after successful apply (processedAt set).
  if (existing?.processedAt) {
    return NextResponse.json(
      { ok: true, duplicate: true, eventId: verified.providerEventId },
      { status: 200, headers: { 'x-request-id': requestId } },
    );
  }

  const submission = verified.externalJobId
    ? await prisma.providerSubmission.findFirst({
        where: { provider: providerKey, externalJobId: verified.externalJobId },
        include: { attempt: { include: { item: { include: { run: true } } } } },
      })
    : null;

  if (!submission) {
    // Orphan / early-arrival: persist with processedAt=null for later reconcile.
    if (!existing) {
      await prisma.providerEvent.create({
        data: {
          id: newId(),
          workspaceId: null,
          provider: providerKey,
          externalEventId: verified.providerEventId,
          externalJobId: verified.externalJobId,
          payloadHash: verified.payloadHash,
          payloadJson: verified.raw as never,
          processedAt: null,
        },
      });
    }
    return NextResponse.json(
      { ok: true, warning: 'UNKNOWN_EXTERNAL_JOB', orphan: true },
      { status: 202, headers: { 'x-request-id': requestId } },
    );
  }

  if (!existing) {
    await prisma.providerEvent.create({
      data: {
        id: newId(),
        workspaceId: submission.workspaceId,
        provider: providerKey,
        externalEventId: verified.providerEventId,
        externalJobId: verified.externalJobId,
        payloadHash: verified.payloadHash,
        payloadJson: verified.raw as never,
        processedAt: null,
      },
    });
  }

  await prisma.providerSubmission.update({
    where: { id: submission.id },
    data: {
      status:
        verified.status === 'SUCCEEDED'
          ? 'SUCCEEDED'
          : verified.status === 'FAILED'
            ? 'FAILED'
            : verified.status === 'CANCELED'
              ? 'CANCELED'
              : 'RUNNING',
      heartbeatAt: new Date(),
    },
  });

  const projectId = submission.attempt.item.run.projectId;
  await prisma.progressEvent.create({
    data: {
      id: newId(),
      workspaceId: submission.workspaceId,
      projectId,
      runId: submission.attempt.item.runId,
      attemptId: submission.attemptId,
      type: 'provider.webhook',
      payloadJson: {
        providerEventId: verified.providerEventId,
        externalJobId: verified.externalJobId,
        status: verified.status,
      } as never,
    },
  });

  // Mark processed only after successful apply.
  await prisma.providerEvent.updateMany({
    where: { provider: providerKey, externalEventId: verified.providerEventId },
    data: { processedAt: new Date(), workspaceId: submission.workspaceId },
  });

  // Also drain any other orphans for this job (idempotent).
  await reconcileOrphanProviderEvents(prisma, providerKey, verified.externalJobId);

  return NextResponse.json(
    { ok: true, duplicate: false, eventId: verified.providerEventId },
    { status: 200, headers: { 'x-request-id': requestId } },
  );
}
