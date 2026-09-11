import sharp from 'sharp';
import {
  assertUploadLimits,
  buildAssetObjectKey,
  extensionForMime,
  InspectTransientError,
  InspectValidationError,
  isAnimatedOrDynamicWebp,
  isInspectValidationError,
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

/** Test hooks for failure-injection (CI). Not used in production. */
export type InspectHooks = {
  afterCreateVersion?: (versionId: string) => Promise<void> | void;
  afterWriteObject?: (key: string) => Promise<void> | void;
  afterWriteRepresentation?: (kind: string) => Promise<void> | void;
};

/**
 * W2-01/02 inspect pipeline: download → MIME/pixels/safety → sRGB normalize → thumbnail → version.
 * Idempotent: safe to run twice on the same upload (one version, one representation per kind).
 * Transient S3/DB failures throw (worker retries). Only definitive validation → REJECTED.
 */
export async function inspectUploadedAsset(deps: {
  db: PrismaClient;
  storage: ObjectStorage;
  input: InspectInput;
  hooks?: InspectHooks;
}): Promise<InspectResult> {
  const { db, storage, input, hooks } = deps;
  const assets = new AssetRepository(db);

  const session = await db.uploadSession.findFirst({
    where: { id: input.uploadId, workspaceId: input.workspaceId },
  });
  if (!session) {
    throw new InspectTransientError(`Upload session missing: ${input.uploadId}`);
  }

  // Already successfully inspected — idempotent short-circuit
  if (session.status === 'READY') {
    const asset = await assets.findById(input.workspaceId, input.assetId);
    if (asset?.currentVersionId) {
      const version = await assets.getVersionWithRepresentations(
        input.workspaceId,
        asset.currentVersionId,
      );
      if (version) {
        return {
          ok: true,
          versionId: version.id,
          width: version.width ?? 0,
          height: version.height ?? 0,
          sha256: version.sha256,
        };
      }
    }
  }

  if (session.status === 'REJECTED') {
    return { ok: false, reason: session.rejectionReason ?? 'Previously rejected' };
  }

  await db.uploadSession.updateMany({
    where: { id: input.uploadId, workspaceId: input.workspaceId },
    data: { status: 'INSPECTING' },
  });
  await assets.setStatus(input.workspaceId, input.assetId, 'PROCESSING');

  try {
    let head;
    try {
      head = await storage.headObject(input.expectedKey);
    } catch (err) {
      throw new InspectTransientError('headObject failed', { cause: err });
    }
    if (!head) {
      throw new InspectValidationError('Object missing in storage');
    }
    if (head.contentLength > input.expectedBytes * 1.05 + 1024) {
      throw new InspectValidationError('Uploaded object larger than declared size');
    }

    let body: Buffer;
    try {
      const got = await storage.getObject(input.expectedKey);
      body = got.body;
    } catch (err) {
      throw new InspectTransientError('getObject failed', { cause: err });
    }

    const sniffed = sniffImageMime(body);
    if (!sniffed) {
      throw new InspectValidationError('Unrecognized image magic bytes');
    }
    if (sniffed !== input.expectedMime) {
      throw new InspectValidationError(
        `MIME mismatch: declared ${input.expectedMime}, sniffed ${sniffed}`,
      );
    }
    if (sniffed === 'image/webp' && isAnimatedOrDynamicWebp(body)) {
      throw new InspectValidationError('Animated/dynamic WebP is not allowed');
    }

    const checksum = sha256Hex(body);
    if (
      input.expectedChecksumSha256 &&
      input.expectedChecksumSha256.toLowerCase() !== checksum
    ) {
      throw new InspectValidationError('Checksum mismatch');
    }

    let pipeline = sharp(body, { failOn: 'error', limitInputPixels: 50_000_000 });
    let meta;
    try {
      meta = await pipeline.metadata();
    } catch (err) {
      throw new InspectValidationError(
        err instanceof Error ? `Corrupt image: ${err.message}` : 'Corrupt image',
      );
    }
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if ((meta.pages ?? 1) > 1) {
      throw new InspectValidationError('Multi-frame / animated images are not allowed');
    }
    try {
      assertUploadLimits({
        mime: sniffed,
        bytes: body.length,
        width,
        height,
      });
    } catch (e) {
      throw new InspectValidationError(e instanceof Error ? e.message : 'Limit failed');
    }

    // Re-create pipeline after metadata read — rotate honors orientation then strips EXIF/GPS
    pipeline = sharp(body, { failOn: 'error', limitInputPixels: 50_000_000 });
    const normalized = await pipeline
      .rotate()
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

    const versionNumber = await assets.resolveInspectVersionNumber(
      input.workspaceId,
      input.assetId,
    );
    const ext = extensionForMime(sniffed as AllowedUploadMime);
    const originalKey = input.expectedKey;
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
        exifStripped: true,
      },
    });
    await hooks?.afterCreateVersion?.(version.id);

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

    try {
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
    } catch (err) {
      throw new InspectTransientError('putObject failed', { cause: err });
    }
    await hooks?.afterWriteObject?.(normalizedKey);

    // Never overwrite the original upload object — originalKey stays as uploaded bytes.
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
    await hooks?.afterWriteRepresentation?.('ORIGINAL_UPLOAD');

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
    await hooks?.afterWriteRepresentation?.('NORMALIZED_PNG');

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
    await hooks?.afterWriteRepresentation?.('THUMBNAIL_WEBP');

    await assets.setCurrentVersion(input.workspaceId, input.assetId, version.id);
    await db.uploadSession.updateMany({
      where: { id: input.uploadId, workspaceId: input.workspaceId },
      data: { status: 'READY', rejectionReason: null },
    });

    return {
      ok: true,
      versionId: version.id,
      width,
      height,
      sha256: checksum,
    };
  } catch (err) {
    if (isInspectValidationError(err)) {
      return reject(db, assets, input, err.message);
    }
    // Transient or unexpected — rethrow so BullMQ retries; do NOT mark REJECTED
    if (err instanceof InspectTransientError) throw err;
    throw new InspectTransientError(
      err instanceof Error ? err.message : 'Inspect failed',
      { cause: err },
    );
  }
}

async function reject(
  db: PrismaClient,
  assets: AssetRepository,
  input: InspectInput,
  reason: string,
): Promise<InspectResult> {
  await db.uploadSession.updateMany({
    where: { id: input.uploadId, workspaceId: input.workspaceId },
    data: { status: 'REJECTED', rejectionReason: reason },
  });
  await assets.setStatus(input.workspaceId, input.assetId, 'REJECTED');
  return { ok: false, reason };
}
