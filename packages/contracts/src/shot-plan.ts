import { z } from 'zod';

export const ShotBriefSlotSchema = z.enum([
  'MAIN',
  'FEATURE',
  'DETAIL',
  'DIMENSION',
  'LIFESTYLE',
  'PACKAGE',
]);

export const ShotBriefConstraintsSchema = z.object({
  must: z.array(z.string()),
  mustNot: z.array(z.string()),
  qaPolicy: z.string(),
  aspectRatio: z.string(),
  targetPixels: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  /** W3-08 prep: asset versions the canvas materialize step may wire in. */
  referencedAssetVersionIds: z.array(z.string().uuid()),
});

export const ShotBriefSchema = z.object({
  id: z.string().uuid(),
  slot: ShotBriefSlotSchema,
  purpose: z.string(),
  orderIndex: z.number().int().positive(),
  copy: z.array(z.unknown()),
  constraints: ShotBriefConstraintsSchema,
});

export const ShotPlanRevisionSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int(),
  status: z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SUPERSEDED']),
  truthRevisionId: z.string().uuid(),
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
  briefs: z.array(ShotBriefSchema),
  approvedAt: z.string().datetime().nullable(),
  approvedByUserId: z.string().uuid().nullable(),
});

export const ShotPlanResponseSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  currentRevisionId: z.string().uuid().nullable(),
  approvedRevisionId: z.string().uuid().nullable(),
  revision: ShotPlanRevisionSchema.nullable(),
  /** W3-08 prep: stable payload for later canvas materialize (null if no revision). */
  canvasPayload: z
    .object({
      planDocumentId: z.string().uuid(),
      planRevisionId: z.string().uuid(),
      projectId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      truthRevisionId: z.string().uuid(),
      briefs: z.array(
        z.object({
          briefId: z.string().uuid(),
          slot: ShotBriefSlotSchema,
          purpose: z.string(),
          orderIndex: z.number().int(),
          aspectRatio: z.string(),
          targetPixels: z.object({
            width: z.number().int(),
            height: z.number().int(),
          }),
          copy: z.array(z.unknown()),
          must: z.array(z.string()),
          mustNot: z.array(z.string()),
          qaPolicy: z.string(),
          referencedAssetVersionIds: z.array(z.string().uuid()),
        }),
      ),
    })
    .nullable(),
});

export const GenerateShotPlanRequestSchema = z.object({
  /** Optional; server uses project's approved Truth revision when omitted. */
  truthRevisionId: z.string().uuid().optional(),
  includePackage: z.boolean().optional(),
  /** V2: free-text owner intent — selling points / scenes / style for the planner. */
  intent: z.string().max(2000).optional(),
  /** V2: when true, server auto-approves if the workspace has autoApproveGates on. */
  autoApprove: z.boolean().optional(),
});

export const SaveShotPlanRequestSchema = z.object({
  truthRevisionId: z.string().uuid().optional(),
  readyForReview: z.boolean().optional().default(true),
  briefs: z
    .array(
      z.object({
        slot: ShotBriefSlotSchema,
        purpose: z.string().min(1).max(512),
        orderIndex: z.number().int().positive(),
        copy: z.array(z.unknown()).optional(),
        must: z.array(z.string()).optional(),
        mustNot: z.array(z.string()).optional(),
        qaPolicy: z.string().optional(),
        aspectRatio: z.string().optional(),
        targetPixels: z
          .object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .optional(),
        referencedAssetVersionIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const ApproveShotPlanRequestSchema = z.object({
  revisionId: z.string().uuid(),
});

export type GenerateShotPlanRequest = z.infer<typeof GenerateShotPlanRequestSchema>;
export type SaveShotPlanRequest = z.infer<typeof SaveShotPlanRequestSchema>;
export type ApproveShotPlanRequest = z.infer<typeof ApproveShotPlanRequestSchema>;
