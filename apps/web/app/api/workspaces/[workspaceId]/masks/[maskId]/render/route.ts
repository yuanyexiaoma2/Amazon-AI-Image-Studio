import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import {
  MaskRepository,
  AssetRepository,
  prisma,
} from '@studio/db';
import {
  WORKFLOW_WRITE_ROLES,
  buildAssetObjectKey,
  type MaskStroke,
  validateStrokesJson,
} from '@studio/domain';
import { renderMaskPng } from '@studio/imaging';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { ensureStorageReady } from '@/lib/storage';

type Ctx = { params: Promise<{ workspaceId: string; maskId: string }> };

/**
 * Render mask strokes → full-res grayscale PNG matching source Asset Version WxH (§10.4).
 * Persists MASK_PNG representation + updates mask metadata (renderedSha256, dimensions).
 */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, maskId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...WORKFLOW_WRITE_ROLES]);
  if (!access.ok) return access.response;

  const masks = new MaskRepository(prisma);
  const mask = await masks.findById(workspaceId, maskId);
  if (!mask) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Mask not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const assets = new AssetRepository(prisma);
  const version = await assets.getVersionWithRepresentations(workspaceId, mask.assetVersionId);
  if (!version || !version.width || !version.height) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Source asset version missing dimensions', requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const validated = validateStrokesJson(mask.strokesJson);
  if (!validated.ok) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', validated.issues.join('; '), requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const width = version.width;
  const height = version.height;
  const png = await renderMaskPng({
    width,
    height,
    strokes: validated.strokes as MaskStroke[],
  });
  const sha256 = createHash('sha256').update(png).digest('hex');

  const asset = await assets.findById(workspaceId, version.assetId);
  if (!asset) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Parent asset missing', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const storage = await ensureStorageReady();
  const key = buildAssetObjectKey({
    workspaceId,
    projectId: asset.projectId,
    assetId: asset.id,
    kind: 'masks',
    versionId: mask.assetVersionId,
    ext: 'png',
  });
  // Unique key per mask render
  const renderKey = key.replace(/\.png$/, `-${maskId.slice(0, 8)}.png`);

  await storage.putObject({
    key: renderKey,
    body: png,
    contentType: 'image/png',
  });

  // Upsert MASK_PNG representation on the source version (or create dedicated mask asset)
  const existingRep = version.representations.find((r) => r.kind === 'MASK_PNG');
  if (existingRep) {
    await prisma.assetRepresentation.update({
      where: { id: existingRep.id },
      data: {
        storageKey: renderKey,
        sha256,
        bytes: png.length,
        width,
        height,
        contentType: 'image/png',
      },
    });
  } else {
    await assets.addRepresentation({
      workspaceId,
      assetVersionId: version.id,
      kind: 'MASK_PNG',
      storageKey: renderKey,
      sha256,
      bytes: png.length,
      width,
      height,
      contentType: 'image/png',
    });
  }

  const prevMeta = (mask.metadataJson ?? {}) as Record<string, unknown>;
  await masks.update(workspaceId, maskId, {
    metadataJson: {
      ...prevMeta,
      sourceWidth: width,
      sourceHeight: height,
      renderedSha256: sha256,
      renderedStorageKey: renderKey,
      renderedByteSize: png.length,
      renderedAt: new Date().toISOString(),
    } as never,
  });

  const signed = await storage.getSignedUrl({
    key: renderKey,
    expiresInSeconds: 900,
  });

  return NextResponse.json(
    {
      maskId,
      width,
      height,
      sha256,
      byteSize: png.length,
      storageKey: renderKey,
      maskAssetVersionId: version.id,
      downloadUrl: signed,
    },
    { headers: { 'x-request-id': requestId } },
  );
}
