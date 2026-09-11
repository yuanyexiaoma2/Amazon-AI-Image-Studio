import { z } from 'zod';

export const PresignUploadRequestSchema = z.object({
  projectId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: z.number().int().positive().max(20 * 1024 * 1024),
});

export const PresignUploadResponseSchema = z.object({
  uploadId: z.string().uuid(),
  assetId: z.string().uuid(),
  uploadUrl: z.string().url(),
  storageKey: z.string(),
  expiresAt: z.string().datetime(),
  headers: z.record(z.string()).optional(),
});

export const CompleteUploadRequestSchema = z.object({
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  /** Client idempotency key — retries with same key return the same result. */
  completionKey: z.string().min(8).max(128).optional(),
});

export const CompleteUploadResponseSchema = z.object({
  uploadId: z.string().uuid(),
  assetId: z.string().uuid(),
  status: z.enum([
    'CREATED',
    'UPLOADING',
    'UPLOADED',
    'INSPECTING',
    'READY',
    'REJECTED',
    'EXPIRED',
  ]),
  assetStatus: z.enum(['UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'ARCHIVED']),
});

export type PresignUploadRequest = z.infer<typeof PresignUploadRequestSchema>;
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;
