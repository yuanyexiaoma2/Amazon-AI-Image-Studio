import { z } from 'zod';

export const AssetSummarySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: z.enum(['PRODUCT_PHOTO', 'REFERENCE', 'MASK', 'GENERATED', 'OTHER']),
  status: z.enum(['UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'ARCHIVED']),
  currentVersionId: z.string().uuid().nullable(),
  originalFilename: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const AssetVersionSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  versionNumber: z.number().int(),
  sha256: z.string(),
  mime: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  colorSpace: z.string().nullable(),
  byteSize: z.number().int(),
  representations: z
    .array(
      z.object({
        kind: z.enum([
          'ORIGINAL_UPLOAD',
          'NORMALIZED_PNG',
          'THUMBNAIL_WEBP',
          'MASK_PNG',
          'EDITOR_PREVIEW',
        ]),
        storageKey: z.string(),
        contentType: z.string(),
        bytes: z.number().int(),
        width: z.number().int().nullable().optional(),
        height: z.number().int().nullable().optional(),
      }),
    )
    .optional(),
});

export const DownloadUrlResponseSchema = z.object({
  url: z.string().url(),
  expiresInSeconds: z.number().int(),
  representationKind: z.string(),
});
