import { z } from 'zod';

export const MaskStrokePointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const MaskStrokeSchema = z.object({
  tool: z.enum(['brush', 'erase']),
  size: z.number().gt(0).max(1),
  points: z.array(MaskStrokePointSchema).min(1),
  feather: z.number().min(0).max(1).optional(),
});

export const CreateMaskRequestSchema = z.object({
  strokes: z.array(MaskStrokeSchema).default([]),
  coordinateSpace: z.literal('normalized_0_1').optional().default('normalized_0_1'),
  metadata: z
    .object({
      sourceWidth: z.number().int().positive().optional(),
      sourceHeight: z.number().int().positive().optional(),
      viewportVersion: z.number().optional(),
      zoom: z.number().positive().optional(),
      featherDefault: z.number().min(0).max(1).optional(),
    })
    .passthrough()
    .optional()
    .default({}),
});

export const UpdateMaskRequestSchema = z.object({
  strokes: z.array(MaskStrokeSchema),
  coordinateSpace: z.literal('normalized_0_1').optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const MaskResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  assetVersionId: z.string().uuid(),
  strokes: z.array(MaskStrokeSchema),
  coordinateSpace: z.string(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const RenderMaskResponseSchema = z.object({
  maskId: z.string().uuid(),
  width: z.number().int(),
  height: z.number().int(),
  sha256: z.string(),
  byteSize: z.number().int(),
  storageKey: z.string(),
  maskAssetVersionId: z.string().uuid().nullable().optional(),
  downloadUrl: z.string().url().optional(),
});
