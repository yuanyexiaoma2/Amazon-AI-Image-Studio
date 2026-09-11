import sharp from 'sharp';
import {
  assertUploadLimits,
  buildAssetObjectKey,
  extensionForMime,
  sniffImageMime,
  THUMBNAIL_MAX_EDGE,
  type AllowedUploadMime,
} from '@studio/domain';
import { AssetRepository, type PrismaClient } from '@studio/db';
import type { ObjectStorage } from '@studio/storage';
import { sha256Hex } from './hash.js';

export type InspectInput = {
  workspaceId: string;
  uploadId: string;
  assetId: string;
  projectId: string;
  expectedKey: string;
  expectedMime: string;
  expectedBytes: number;
  expectedChecksumSha256?: string | null;
};

export type InspectResult =
  | { ok: true; versionId: string; width: number; height: number; sha256: string }
  | { ok: false; reason: string };

/**
 * W2-01/02 inspect pipeline: download → MIME/pixels/safety → sRGB normalize → thumbnail → version.
 */
export async function inspectUploadedAsset(deps: {
  db: PrismaClient;
  storage: ObjectStorage;
  input: InspectInput;
}): Promise<InspectResult> {
  const { db, storage, input } = deps;
  const assets = new AssetRepository(db);

  await db.uploadSession.update({
    where: { id: input.uploadId },
    data: { status: 'INSPECTING' },
  });
  await assets.setStatus(input.workspaceId, input.assetId, 'PROCESSING');

  try {
    const head = await storage.headObject(input.expectedKey);
    if (!head) {
      return reject(db, assets, input, 'Object missing in storage');
    }
    if (head.contentLength > input.expectedBytes * 1.05 + 1024) {
      return reject(db, assets, input, 'Uploaded object larger than declared size');
    }

    const { body } = await storage.getObject(input.expectedKey);
    const sniffed = sniffImageMime(body);
    if (!sniffed) {
      return reject(db, assets, input, 'Unrecognized image magic bytes');
    }
    if (sniffed !== input.expectedMime) {
      return reject(
        db,
        assets,
        input,
        `MIME mismatch: declared ${input.expectedMime}, sniffed ${sniffed}`,
      );
    }

    const checksum = sha256Hex(body);
    if (
      input.expectedChecksumSha256 &&
      input.expectedChecksumSha256.toLowerCase() !== checksum
    ) {
      return reject(db, assets, input, 'Checksum mismatch');
    }

    // Decode + pixel guard + strip metadata + sRGB
    let pipeline = sharp(body, { failOn: 'error', limitInputPixels: 50_000_000 });
    const meta = await pipeline.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    try {
      assertUploadLimits({
        mime: sniffed,
        bytes: body.length,
        width,
        height,
      });
    } catch (e) {
      return reject(db, assets, input, e instanceof Error ? e.message : 'Limit failed');
    }

    // Re-create pipeline after metadata read
    pipeline = sharp(body, { failOn: 'error', limitInputPixels: 50_000_000 });
    const normalized = await pipeline
      .rotate() // honor orientation then strip EXIF/GPS
      .toColorspace('srgb')
      .png()
      .toBuffer({ resolveWithObject: true });

    const thumb = await sharp(normalized.data)
      .resize({
        width: THUMBNAIL_MAX_EDGE,
        height: THUMBNAIL_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    const versionNumber = await assets.nextVersionNumber(input.workspaceId, input.assetId);
    const ext = extensionForMime(sniffed as AllowedUploadMime);
    const originalKey = input.expectedKey;
    // Presign embeds version id: .../original/{versionId}.{ext}
    const baseName = originalKey.split('/').pop() ?? '';
    const pendingVersionId = baseName.includes('.')
      ? baseName.slice(0, baseName.lastIndexOf('.'))
      : undefined;

    const version = await assets.createVersion({
      id: pendingVersionId,
      workspaceId: input.workspaceId,
      assetId: input.assetId,
      versionNumber,
      sha256: checksum,
      mime: sniffed,
      width,
      height,
      colorSpace: 'sRGB',
      byteSize: body.length,
      metadataJson: {
        sniffedMime: sniffed,
        originalBytes: body.length,
        normalizedBytes: normalized.data.length,
        hasAlpha: Boolean(meta.hasAlpha),
      },
    });

    const normalizedKey = buildAssetObjectKey({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      assetId: input.assetId,
      kind: 'normalized',
      versionId: version.id,
      ext: 'png',
    });
    const thumbKey = buildAssetObjectKey({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      assetId: input.assetId,
      kind: 'thumbnails',
      versionId: version.id,
      ext: 'webp',
    });

    await storage.putObject({
      key: normalizedKey,
      body: normalized.data,
      contentType: 'image/png',
    });
    await storage.putObject({
      key: thumbKey,
      body: thumb.data,
      contentType: 'image/webp',
    });

    await assets.addRepresentation({
      workspaceId: input.workspaceId,
      assetVersionId: version.id,
      kind: 'ORIGINAL_UPLOAD',
      storageKey: originalKey,
      sha256: checksum,
      bytes: body.length,
      width,
      height,
      contentType: sniffed,
    });
    await assets.addRepresentation({
      workspaceId: input.workspaceId,
      assetVersionId: version.id,
      kind: 'NORMALIZED_PNG',
      storageKey: normalizedKey,
      sha256: sha256Hex(normalized.data),
      bytes: normalized.data.length,
      width: normalized.info.width,
      height: normalized.info.height,
      contentType: 'image/png',
    });
    await assets.addRepresentation({
      workspaceId: input.workspaceId,
      assetVersionId: version.id,
      kind: 'THUMBNAIL_WEBP',
      storageKey: thumbKey,
      sha256: sha256Hex(thumb.data),
      bytes: thumb.data.length,
      width: thumb.info.width,
      height: thumb.info.height,
      contentType: 'image/webp',
    });

    await assets.setCurrentVersion(input.workspaceId, input.assetId, version.id);
    await db.uploadSession.update({
      where: { id: input.uploadId },
      data: { status: 'READY' },
    });

    return {
      ok: true,
      versionId: version.id,
      width,
      height,
      sha256: checksum,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Inspect failed';
    return reject(db, assets, input, reason);
  }
}

async function reject(
  db: PrismaClient,
  assets: AssetRepository,
  input: InspectInput,
  reason: string,
): Promise<InspectResult> {
  await db.uploadSession.update({
    where: { id: input.uploadId },
    data: { status: 'REJECTED', rejectionReason: reason },
  });
  await assets.setStatus(input.workspaceId, input.assetId, 'REJECTED');
  return { ok: false, reason };
}
