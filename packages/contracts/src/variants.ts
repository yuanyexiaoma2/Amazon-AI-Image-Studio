import { z } from 'zod';
import { BudgetLimitSchema } from './generation.js';

export const VariantComponentSchema = z.object({
  componentKey: z.string().min(1).max(64),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  colorDescription: z.string().max(256).nullable().optional(),
  material: z.string().max(128).nullable().optional(),
  locks: z.array(z.string()).optional(),
  allowedChanges: z.array(z.string()).optional(),
});

export const CreateVariantRequestSchema = z.object({
  code: z.string().min(1).max(32),
  displayName: z.string().min(1).max(128),
  masterVariantId: z.string().uuid().nullable().optional(),
  components: z.array(VariantComponentSchema).optional(),
  status: z.enum(['DRAFT', 'READY', 'ARCHIVED']).optional(),
});

export const PatchVariantRequestSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  status: z.enum(['DRAFT', 'READY', 'ARCHIVED']).optional(),
  components: z.array(VariantComponentSchema).optional(),
  workflowId: z.string().uuid().nullable().optional(),
});

export const MaterializeVariantRequestSchema = z.object({
  sourceWorkflowId: z.string().uuid().optional(),
  name: z.string().min(1).max(128).optional(),
});

export const CreateVariantRunRequestSchema = z.object({
  masterVariantId: z.string().uuid(),
  variantIds: z.array(z.string().uuid()).min(1).max(32),
  budgetLimit: BudgetLimitSchema.optional().nullable(),
  confirmBudget: z.boolean().optional().default(false),
  idempotencyKey: z.string().uuid().or(z.string().min(8).max(128)),
  /** Per-item Fake scenarios keyed by `${variantCode}:${slot}` or `*`. */
  itemScenarios: z.record(z.string()).optional(),
  /** Default Fake generation scenario for items. */
  scenario: z.string().optional(),
  /** Vision QA scenario applied after success (or per-item override). */
  visionScenario: z.string().optional(),
});

export const RetryVariantItemRequestSchema = z.object({
  scenario: z.string().optional(),
  visionScenario: z.string().optional(),
});

export const VariantExportRequestSchema = z.object({
  variantRunId: z.string().uuid(),
  onlyPassing: z.boolean().optional().default(true),
  allowReview: z.boolean().optional().default(false),
});

export const CreditAdjustRequestSchema = z.object({
  microunits: z.number().int().positive(),
  note: z.string().min(1).max(512),
  idempotencyKey: z.string().min(8).max(128),
});

export const VariantSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  code: z.string(),
  displayName: z.string(),
  masterVariantId: z.string().uuid().nullable(),
  status: z.string(),
  workflowId: z.string().uuid().nullable().optional(),
  components: z.array(
    z.object({
      id: z.string().uuid(),
      componentKey: z.string(),
      colorHex: z.string().nullable().optional(),
      colorDescription: z.string().nullable().optional(),
      material: z.string().nullable().optional(),
      locks: z.array(z.string()),
      allowedChanges: z.array(z.string()),
    }),
  ),
  createdAt: z.string(),
});

export const VariantItemSchema = z.object({
  id: z.string().uuid(),
  variantId: z.string().uuid(),
  variantRunId: z.string().uuid().nullable().optional(),
  slot: z.string(),
  outputIndex: z.number().int(),
  status: z.string(),
  generationItemId: z.string().uuid().nullable().optional(),
  selectedAssetVersionId: z.string().uuid().nullable().optional(),
  qaReportId: z.string().uuid().nullable().optional(),
  errorClass: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});

export const VariantRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  masterVariantId: z.string().uuid(),
  status: z.string(),
  estimateMicrounits: z.number().int(),
  currency: z.string(),
  confirmBudget: z.boolean(),
  items: z.array(VariantItemSchema),
  createdAt: z.string(),
  completedAt: z.string().nullable().optional(),
});
