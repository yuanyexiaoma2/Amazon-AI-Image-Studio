import { NextResponse } from 'next/server';
import { CompleteUploadRequestSchema, makeApiError } from '@studio/contracts';
import { prisma, UploadRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { ensureStorageReady } from '@/lib/storage';
import { enqueueInspect } from '@/lib/queues';

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
    const existing = await uploads.findByCompletionKey(parsed.data.completionKey);
    if (existing && existing.workspaceId === workspaceId) {
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

  const storage = await ensureStorageReady();
  const head = await storage.headObject(session.expectedKey);
  if (!head) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Object not found — upload the file before complete', requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  await uploads.markStatus(workspaceId, uploadId, 'UPLOADED', {
    completionKey: parsed.data.completionKey,
    expectedChecksumSha256: parsed.data.checksumSha256,
  });
  await uploads.markStatus(workspaceId, uploadId, 'INSPECTING');
  await prisma.asset.update({
    where: { id: session.assetId },
    data: { status: 'PROCESSING' },
  });

  await enqueueInspect({
    workspaceId,
    uploadId: session.id,
    assetId: session.assetId,
    projectId: session.projectId,
    expectedKey: session.expectedKey,
    expectedMime: session.expectedMime,
    expectedBytes: session.expectedBytes,
    expectedChecksumSha256: parsed.data.checksumSha256 ?? session.expectedChecksumSha256,
  });

  const refreshed = await uploads.findSession(workspaceId, uploadId);
  const asset = await prisma.asset.findFirst({ where: { id: session.assetId, workspaceId } });

  return NextResponse.json(
    {
      uploadId: session.id,
      assetId: session.assetId,
      status: refreshed?.status ?? 'INSPECTING',
      assetStatus: asset?.status ?? 'PROCESSING',
    },
    { headers: { 'x-request-id': requestId } },
  );
}
