import { z } from 'zod';

/**
 * W3-05 — Zod config schemas for MVP node types (spec §8.3).
 * Palette nodes: 11; approval_selector is system-only (not manually created).
 * Every config carries schemaVersion for draft migrations (spec §8.4).
 */

export const NodeConfigBaseSchema = z.object({
  schemaVersion: z.literal(1).default(1),
});

export const SourceImageConfigSchema = NodeConfigBaseSchema.extend({
  assetVersionId: z.string().uuid().optional().nullable(),
});

export const ProductTruthConfigSchema = NodeConfigBaseSchema.extend({
  /** Approved Truth Pack revision id (UUID). Spec example used a number; we store the revision UUID. */
  truthRevisionId: z.string().uuid().optional().nullable(),
});

export const PromptConfigSchema = NodeConfigBaseSchema.extend({
  text: z.string().max(8000).optional().default(''),
  negative: z.string().max(4000).optional().default(''),
  locale: z.string().max(16).optional().default('en-US'),
  shotBriefId: z.string().uuid().optional().nullable(),
  slot: z.string().max(32).optional().nullable(),
});

export const RemoveBackgroundConfigSchema = NodeConfigBaseSchema.extend({
  subjectHint: z.string().max(256).optional().default('product'),
  edgeMode: z.enum(['auto', 'precise', 'soft']).optional().default('auto'),
});

export const GenerateConfigSchema = NodeConfigBaseSchema.extend({
  modelKey: z.string().min(1).max(128).optional().default('auto'),
  ratio: z.string().max(16).optional().default('1:1'),
  resolution: z.enum(['1K', '2K', '4K']).optional().default('2K'),
  count: z.number().int().min(1).max(8).optional().default(2),
  seed: z.number().int().optional().nullable(),
  briefSlot: z.string().max(32).optional().nullable(),
  briefOrderIndex: z.number().int().optional().nullable(),
});

export const ReplaceBackgroundConfigSchema = NodeConfigBaseSchema.extend({
  fidelity: z.number().min(0).max(1).optional().default(0.85),
  lightBlend: z.number().min(0).max(1).optional().default(0.5),
  /** Optional direct bind to Mask row (W5-B editor); MASK port also accepted. */
  maskId: z.string().uuid().optional().nullable(),
});

export const InpaintConfigSchema = NodeConfigBaseSchema.extend({
  strength: z.number().min(0).max(1).optional().default(0.6),
  modelKey: z.string().min(1).max(128).optional().default('auto'),
  /** Optional direct bind to Mask row (W5-B editor); MASK port also accepted. */
  maskId: z.string().uuid().optional().nullable(),
});

export const OutpaintConfigSchema = NodeConfigBaseSchema.extend({
  targetRatio: z.string().max(16).optional().default('1:1'),
  placement: z.enum(['center', 'top', 'bottom', 'left', 'right']).optional().default('center'),
  modelKey: z.string().min(1).max(128).optional().default('auto'),
});

export const UpscaleConfigSchema = NodeConfigBaseSchema.extend({
  engineKey: z.string().min(1).max(128).optional().default('default-upscale'),
  targetResolution: z.enum(['2K', '4K']).optional().default('4K'),
});

export const QaGateConfigSchema = NodeConfigBaseSchema.extend({
  policyKey: z.string().min(1).max(128).optional().default('amazon-generic-us-v1'),
});

export const ApprovalSelectorConfigSchema = NodeConfigBaseSchema.extend({
  requiredRole: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'REVIEWER']).optional().default('REVIEWER'),
});

export const ExportConfigSchema = NodeConfigBaseSchema.extend({
  namingPreset: z.string().max(128).optional().default('amazon-listing-v1'),
  format: z.enum(['png', 'jpeg', 'webp']).optional().default('png'),
  /** Provenance: Shot Plan revision this workflow was materialized from (W3-08). */
  sourcePlanRevisionId: z.string().uuid().optional().nullable(),
});

/** Discriminated map: node type → config schema (includes system approval_selector). */
export const NODE_CONFIG_SCHEMAS = {
  source_image: SourceImageConfigSchema,
  product_truth: ProductTruthConfigSchema,
  prompt: PromptConfigSchema,
  remove_background: RemoveBackgroundConfigSchema,
  generate: GenerateConfigSchema,
  replace_background: ReplaceBackgroundConfigSchema,
  inpaint: InpaintConfigSchema,
  outpaint: OutpaintConfigSchema,
  upscale: UpscaleConfigSchema,
  qa_gate: QaGateConfigSchema,
  approval_selector: ApprovalSelectorConfigSchema,
  export: ExportConfigSchema,
} as const;

export type WorkflowNodeConfigType = keyof typeof NODE_CONFIG_SCHEMAS;

/** The 11 MVP palette node types (approval_selector excluded). */
export const PALETTE_NODE_CONFIG_TYPES = [
  'source_image',
  'product_truth',
  'prompt',
  'remove_background',
  'generate',
  'replace_background',
  'inpaint',
  'outpaint',
  'upscale',
  'qa_gate',
  'export',
] as const satisfies ReadonlyArray<WorkflowNodeConfigType>;

export function isWorkflowNodeConfigType(type: string): type is WorkflowNodeConfigType {
  return Object.prototype.hasOwnProperty.call(NODE_CONFIG_SCHEMAS, type);
}

export function defaultNodeConfig(type: WorkflowNodeConfigType): Record<string, unknown> {
  const schema = NODE_CONFIG_SCHEMAS[type];
  return schema.parse({});
}

export type NodeConfigValidation =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; issues: string[] };

/** Parse + fill defaults for a node config; unknown types get base schemaVersion only. */
export function validateNodeConfig(
  type: string,
  config: unknown,
): NodeConfigValidation {
  if (!isWorkflowNodeConfigType(type)) {
    return { ok: true, config: { schemaVersion: 1 } };
  }
  const parsed = NODE_CONFIG_SCHEMAS[type].safeParse(config ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`),
    };
  }
  return { ok: true, config: parsed.data as Record<string, unknown> };
}

/** Validate every node config in a graph; returns normalized configs or aggregated issues. */
export function validateGraphNodeConfigs(
  nodes: Array<{ id: string; type: string; config?: unknown }>,
): NodeConfigValidation & { normalized?: Array<{ id: string; config: Record<string, unknown> }> } {
  const issues: string[] = [];
  const normalized: Array<{ id: string; config: Record<string, unknown> }> = [];
  for (const n of nodes) {
    const result = validateNodeConfig(n.type, n.config);
    if (!result.ok) {
      for (const issue of result.issues) {
        issues.push(`${n.id} (${n.type}): ${issue}`);
      }
    } else {
      normalized.push({ id: n.id, config: result.config });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, config: {}, normalized };
}
