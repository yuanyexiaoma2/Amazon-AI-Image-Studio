import { z } from 'zod';

export const FactStatusSchema = z.enum(['EXTRACTED', 'CONFIRMED', 'REJECTED', 'LOCKED']);
export const ConstraintKindSchema = z.enum(['LOCK', 'ALLOW', 'UNKNOWN']);

export const ProductFactSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  value: z.unknown(),
  confidence: z.number(),
  status: FactStatusSchema,
  evidenceAssetVersionIds: z.array(z.string().uuid()),
});

export const ProductConstraintSchema = z.object({
  id: z.string().uuid(),
  kind: ConstraintKindSchema,
  path: z.string(),
  rule: z.string(),
  severity: z.string(),
});

export const TruthPackResponseSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  currentRevisionId: z.string().uuid().nullable(),
  approvedRevisionId: z.string().uuid().nullable(),
  revision: z
    .object({
      id: z.string().uuid(),
      revision: z.number().int(),
      status: z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SUPERSEDED']),
      facts: z.array(ProductFactSchema),
      constraints: z.array(ProductConstraintSchema),
      approvedAt: z.string().datetime().nullable(),
      approvedByUserId: z.string().uuid().nullable(),
    })
    .nullable(),
});

export const SaveTruthPackRequestSchema = z.object({
  facts: z
    .array(
      z.object({
        key: z.string().min(1).max(128),
        value: z.unknown(),
        confidence: z.number().min(0).max(1).optional(),
        status: FactStatusSchema.optional(),
        evidenceAssetVersionIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1),
  locks: z.array(z.string().min(1)).optional(),
  allowedChanges: z.array(z.string().min(1)).optional(),
});

export const ConfirmFactsRequestSchema = z.object({
  updates: z
    .array(
      z.object({
        factId: z.string().uuid(),
        status: z.enum(['CONFIRMED', 'REJECTED', 'LOCKED', 'EXTRACTED']),
      }),
    )
    .min(1),
});

export const ExtractTruthRequestSchema = z.object({
  assetVersionIds: z.array(z.string().uuid()).min(1).max(30),
});

export const ApproveTruthRequestSchema = z.object({
  revisionId: z.string().uuid(),
});

export type SaveTruthPackRequest = z.infer<typeof SaveTruthPackRequestSchema>;
export type ConfirmFactsRequest = z.infer<typeof ConfirmFactsRequestSchema>;
