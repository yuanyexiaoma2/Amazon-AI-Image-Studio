import { NextResponse } from 'next/server';
import { PresignUploadRequestSchema, makeApiError } from '@studio/contracts';
import {
  assertUploadLimits,
  buildAssetObjectKey,
  extensionForMime,
  PRESIGN_TTL_SECONDS,
} from '@studio/domain';
import { prisma, ProjectRepository, newId } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { ensureStorageReady } from '@/lib/storage';

type Ctx = { params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;
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

  const parsed = PresignUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid upload payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  try {
    assertUploadLimits({ mime: parsed.data.mimeType, bytes: parsed.data.bytes });
  } catch (e) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', e instanceof Error ? e.message : 'Limits', requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const projects = new ProjectRepository(prisma);
  const project = await projects.findById(workspaceId, parsed.data.projectId);
  if (!project) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const assetId = newId();
  const versionId = newId();
  const sessionId = newId();
  const ext = extensionForMime(parsed.data.mimeType);
  const expectedKey = buildAssetObjectKey({
    workspaceId,
    projectId: project.id,
    assetId,
    kind: 'original',
    versionId,
    ext,
  });
  const expiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.asset.create({
      data: {
        id: assetId,
        workspaceId,
        projectId: project.id,
        kind: 'PRODUCT_PHOTO',
        status: 'UPLOADING',
        originalFilename: parsed.data.filename,
        createdByUserId: access.session.userId,
      },
    });
    await tx.uploadSession.create({
      data: {
        id: sessionId,
        workspaceId,
        projectId: project.id,
        assetId,
        expectedKey,
        expectedMime: parsed.data.mimeType,
        expectedBytes: parsed.data.bytes,
        status: 'CREATED',
        expiresAt,
        createdByUserId: access.session.userId,
      },
    });
  });

  const storage = await ensureStorageReady();
  const uploadUrl = await storage.getSignedPutUrl({
    key: expectedKey,
    contentType: parsed.data.mimeType,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
    contentLength: parsed.data.bytes,
  });

  return NextResponse.json(
    {
      uploadId: sessionId,
      assetId,
      uploadUrl,
      storageKey: expectedKey,
      expiresAt: expiresAt.toISOString(),
      headers: { 'Content-Type': parsed.data.mimeType },
    },
    { status: 201, headers: { 'x-request-id': requestId } },
  );
}
