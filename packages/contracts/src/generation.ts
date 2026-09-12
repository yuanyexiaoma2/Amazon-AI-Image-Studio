import { z } from 'zod';

export const BudgetLimitSchema = z.object({
  currency: z.string().min(1).default('USD'),
  amount: z.number().nonnegative(),
});

export const RunScopeSchema = z.object({
  type: z.enum(['ALL', 'BRANCH_FROM', 'NODES']).default('ALL'),
  nodeId: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
});

export const CreateRunRequestSchema = z.object({
  scope: RunScopeSchema.optional(),
  reuseSucceededInputs: z.boolean().optional().default(true),
  budgetLimit: BudgetLimitSchema.optional().nullable(),
  confirmBudget: z.boolean().optional().default(false),
  idempotencyKey: z.string().uuid().or(z.string().min(8).max(128)),
  modelKey: z.string().optional(),
  /** Fake-only scenario for e2e / W4-06. */
  scenario: z.string().optional(),
});

export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const ModelRegistryEntrySchema = z.object({
  key: z.string(),
  provider: z.string(),
  modelId: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  operations: z.array(z.string()),
  ratios: z.array(z.string()),
  resolutionTiers: z.array(z.string()),
  maxReferenceImages: z.number().int(),
  maxOutputs: z.number().int(),
  supportsSeed: z.boolean(),
  supportsWebhook: z.boolean(),
  pricing: z.object({
    currency: z.string(),
    unit: z.string(),
    estimatedUnitCost: z.number(),
  }),
  configVersion: z.number().int(),
});

export const ModelRegistryResponseSchema = z.object({
  models: z.array(ModelRegistryEntrySchema),
  credits: z
    .object({
      currency: z.string(),
      availableMicrounits: z.number(),
      heldMicrounits: z.number(),
      consumedMicrounits: z.number(),
    })
    .optional(),
});

export const GenerationAttemptRequestSnapshotSchema = z
  .object({
    operation: z.string().optional(),
    nodeType: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    aspectRatio: z.string().optional(),
    resolutionTier: z.string().optional(),
    targetRatio: z.string().optional(),
    placement: z.string().optional(),
    engineKey: z.string().optional(),
    targetResolution: z.string().optional(),
    inputFingerprint: z.string().optional(),
  })
  .passthrough()
  .optional();

export const GenerationAttemptSchema = z.object({
  id: z.string().uuid(),
  attemptNo: z.number().int(),
  status: z.string(),
  provider: z.string(),
  modelId: z.string(),
  progress: z.number().int(),
  errorClass: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string(),
  requestSnapshot: GenerationAttemptRequestSnapshotSchema,
});

export const GenerationItemSchema = z.object({
  id: z.string().uuid(),
  nodeId: z.string(),
  status: z.string(),
  modelKey: z.string(),
  attempts: z.array(GenerationAttemptSchema),
});

export const GenerationRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  workflowRevisionId: z.string().uuid(),
  status: z.string(),
  estimateMicrounits: z.number().int(),
  currency: z.string(),
  idempotencyKey: z.string(),
  scope: z.unknown(),
  items: z.array(GenerationItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateRunResponseSchema = z.object({
  run: GenerationRunSchema,
  created: z.boolean(),
});
