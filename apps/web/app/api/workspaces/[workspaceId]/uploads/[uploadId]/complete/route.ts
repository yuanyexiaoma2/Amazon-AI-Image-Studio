import { NextResponse } from 'next/server';
import { CompleteUploadRequestSchema, makeApiError } from '@studio/contracts';
import {
  isAnimatedOrDynamicWebp,
  normalizeContentType,
  sniffImageMime,
} from '@studio/domain';
import { prisma, UploadRepository, inspectJobId } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { ensureStorageReady } from '@/lib/storage';
import { enqueueInspectFromOutbox } from '@/lib/queues';

type Ctx = { params: Promise<{ workspaceId: string; uploadId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, uploadId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const parsed = CompleteUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid complete payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const uploads = new UploadRepository(prisma);

  if (parsed.data.completionKey) {
    const existing = await uploads.findByCompletionKey(workspaceId, parsed.data.completionKey);
    if (existing) {
      const asset = await prisma.asset.findFirst({
        where: { id: existing.assetId, workspaceId },
      });
      return NextResponse.json(
        {
          uploadId: existing.id,
          assetId: existing.assetId,
          status: existing.status,
          assetStatus: asset?.status ?? 'UPLOADING',
        },
        { headers: { 'x-request-id': requestId } },
      );
    }
  }

  const session = await uploads.findSession(workspaceId, uploadId);
  if (!session) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Upload session not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  if (session.expiresAt.getTime() < Date.now() && session.status === 'CREATED') {
    await uploads.markStatus(workspaceId, uploadId, 'EXPIRED');
    return NextResponse.json(makeApiError('GONE', 'Upload session expired', requestId), {
      status: 410,
      headers: { 'x-request-id': requestId },
    });
  }

  if (session.status === 'READY' || session.status === 'INSPECTING' || session.status === 'UPLOADED') {
    // Recovery: if INSPECTING with pending outbox, attempt relay
    if (session.status === 'INSPECTING') {
      const jobId = inspectJobId(session.id);
      const outbox = await prisma.outboxMessage.findUnique({ where: { jobId } });
      if (outbox && outbox.status === 'PENDING') {
        await enqueueInspectFromOutbox(outbox);
      }
    }
    const asset = await prisma.asset.findFirst({ where: { id: session.assetId, workspaceId } });
    return NextResponse.json(
      {
        uploadId: session.id,
        assetId: session.assetId,
        status: session.status,
        assetStatus: asset?.status ?? 'PROCESSING',
      },
      { headers: { 'x-request-id': requestId } },
    );
  }

  if (session.status === 'REJECTED') {
    return NextResponse.json(
      {
        uploadId: session.id,
        assetId: session.assetId,
        status: session.status,
        assetStatus: 'REJECTED',
        rejectionReason: session.rejectionReason,
      },
      { headers: { 'x-request-id': requestId } },
    );
  }

  const storage = await ensureStorageReady();
  const head = await storage.headObject(session.expectedKey);
  if (!head) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Object not found — upload the file before complete', requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  // Pre-enqueue: size vs session expectation
  const sizeTol = Math.max(1024, Math.floor(session.expectedBytes * 0.05));
  if (Math.abs(head.contentLength - session.expectedBytes) > sizeTol) {
    await uploads.markStatus(workspaceId, uploadId, 'REJECTED', {
      rejectionReason: `Object size ${head.contentLength} does not match expected ${session.expectedBytes}`,
    });
    await prisma.asset.updateMany({
      where: { id: session.assetId, workspaceId },
      data: { status: 'REJECTED' },
    });
    return NextResponse.json(
      makeApiError(
        'VALIDATION_ERROR',
        `Object size mismatch: got ${head.contentLength}, expected ${session.expectedBytes}`,
        requestId,
      ),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  // Pre-enqueue: Content-Type vs session expectation (when storage reports it)
  const reported = normalizeContentType(head.contentType);
  const expected = normalizeContentType(session.expectedMime);
  if (reported && expected && reported !== expected) {
    await uploads.markStatus(workspaceId, uploadId, 'REJECTED', {
      rejectionReason: `Content-Type mismatch: got ${reported}, expected ${expected}`,
    });
    await prisma.asset.updateMany({
      where: { id: session.assetId, workspaceId },
      data: { status: 'REJECTED' },
    });
    return NextResponse.json(
      makeApiError(
        'VALIDATION_ERROR',
        `Content-Type mismatch: got ${reported}, expected ${expected}`,
        requestId,
      ),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  // Pre-enqueue: reject animated/dynamic WebP before queueing
  if (session.expectedMime === 'image/webp' || reported === 'image/webp') {
    const { body: objBody } = await storage.getObject(session.expectedKey);
    const sniffed = sniffImageMime(objBody);
    if (sniffed === 'image/webp' && isAnimatedOrDynamicWebp(objBody)) {
      await uploads.markStatus(workspaceId, uploadId, 'REJECTED', {
        rejectionReason: 'Animated/dynamic WebP is not allowed',
      });
      await prisma.asset.updateMany({
        where: { id: session.assetId, workspaceId },
        data: { status: 'REJECTED' },
      });
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', 'Animated/dynamic WebP is not allowed', requestId),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
  }

  const { session: inspecting, outbox } = await uploads.markInspectingWithOutbox({
    workspaceId,
    uploadId: session.id,
    assetId: session.assetId,
    projectId: session.projectId,
    expectedKey: session.expectedKey,
    expectedMime: session.expectedMime,
    expectedBytes: session.expectedBytes,
    completionKey: parsed.data.completionKey,
    expectedChecksumSha256: parsed.data.checksumSha256,
  });

  // Publish with stable jobId; on failure outbox stays PENDING for recovery
  await enqueueInspectFromOutbox(outbox);

  const refreshed = await uploads.findSession(workspaceId, uploadId);
  const asset = await prisma.asset.findFirst({ where: { id: session.assetId, workspaceId } });

  return NextResponse.json(
    {
      uploadId: inspecting.id,
      assetId: session.assetId,
      status: refreshed?.status ?? 'INSPECTING',
      assetStatus: asset?.status ?? 'PROCESSING',
      outboxStatus: outbox.status,
    },
    { headers: { 'x-request-id': requestId } },
  );
}
