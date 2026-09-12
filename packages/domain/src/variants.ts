/**
 * Variant domain rules (spec §19.7, §31.13). Pure — no Prisma / Next / BullMQ.
 */

import { DEFAULT_SEVEN_IMAGE_TEMPLATE, type ShotBriefSlot } from './shot-plan.js';
import type { WorkspaceRoleName } from './truth.js';
import type { WorkflowGraph, GraphNode } from './workflow-graph.js';
import { budgetExceeded, amountToMicrounits, type BudgetLimit } from './generation-run.js';
import { FAKE_PRIMARY_MODEL } from './model-registry.js';

export const VARIANT_WRITE_ROLES: ReadonlyArray<WorkspaceRoleName> = [
  'OWNER',
  'ADMIN',
  'MEMBER',
];

export const VARIANT_ADMIN_ROLES: ReadonlyArray<WorkspaceRoleName> = ['OWNER', 'ADMIN'];

export type VariantStatus = 'DRAFT' | 'READY' | 'ARCHIVED';
export type VariantItemStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  | 'SKIPPED'
  | 'QA_PASS'
  | 'QA_REVIEW'
  | 'QA_BLOCK';
export type VariantRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELED';

/** Default structure/logo/composition locks for master; color is allowed to change on children. */
export const DEFAULT_VARIANT_LOCKS = [
  'structure',
  'logo',
  'text',
  'composition',
  'attachment_count',
] as const;

export const DEFAULT_ALLOWED_CHANGES = ['color', 'material'] as const;

export type VariantComponentInput = {
  componentKey: string;
  colorHex?: string | null;
  colorDescription?: string | null;
  material?: string | null;
  locks?: string[];
  allowedChanges?: string[];
};

export type CreateVariantInput = {
  code: string;
  displayName: string;
  masterVariantId?: string | null;
  components?: VariantComponentInput[];
  status?: VariantStatus;
};

export function normalizeVariantCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '_');
}

export function validateVariantCode(code: string): { ok: true; code: string } | { ok: false; reason: string } {
  const normalized = normalizeVariantCode(code);
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized)) {
    return { ok: false, reason: 'Variant code must be 1–32 chars [A-Z0-9_-]' };
  }
  return { ok: true, code: normalized };
}

export function validateComponents(
  components: ReadonlyArray<VariantComponentInput>,
): { ok: true } | { ok: false; reason: string } {
  const keys = new Set<string>();
  for (const c of components) {
    const key = c.componentKey.trim();
    if (!key) return { ok: false, reason: 'componentKey required' };
    if (keys.has(key)) return { ok: false, reason: `Duplicate componentKey ${key}` };
    keys.add(key);
    if (c.colorHex && !/^#[0-9A-Fa-f]{6}$/.test(c.colorHex)) {
      return { ok: false, reason: `Invalid colorHex for ${key}` };
    }
  }
  return { ok: true };
}

/** Child cannot point at itself; master must be a root (no master of its own) for MVP. */
export function validateMasterLink(args: {
  variantId?: string;
  masterVariantId: string | null | undefined;
  masterIsRoot: boolean;
  sameProject: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.masterVariantId) return { ok: true };
  if (args.variantId && args.variantId === args.masterVariantId) {
    return { ok: false, reason: 'Variant cannot be its own master' };
  }
  if (!args.sameProject) return { ok: false, reason: 'Master must be in the same project' };
  if (!args.masterIsRoot) {
    return { ok: false, reason: 'Master variant must itself be a root (no nested masters)' };
  }
  return { ok: true };
}

export function defaultSevenSlots(): ReadonlyArray<{ slot: ShotBriefSlot; orderIndex: number }> {
  return DEFAULT_SEVEN_IMAGE_TEMPLATE.map((e) => ({ slot: e.slot, orderIndex: e.orderIndex }));
}

/** Inject color/material overrides into generate node prompts/configs (Fake-friendly). */
export function applyVariantOverridesToGraph(
  graph: WorkflowGraph,
  args: {
    variantCode: string;
    components: ReadonlyArray<VariantComponentInput>;
  },
): WorkflowGraph {
  const colorBits = args.components
    .filter((c) => c.colorHex || c.colorDescription)
    .map((c) => {
      const desc = c.colorDescription ?? c.colorHex ?? '';
      return `${c.componentKey}=${desc}${c.colorHex ? `(${c.colorHex})` : ''}`;
    })
    .join('; ');
  const materialBits = args.components
    .filter((c) => c.material)
    .map((c) => `${c.componentKey}:${c.material}`)
    .join('; ');

  const suffix = [
    `VARIANT_CODE=${args.variantCode}`,
    colorBits ? `COLORS=${colorBits}` : null,
    materialBits ? `MATERIALS=${materialBits}` : null,
    'LOCKS=structure,logo,text,composition,attachment_count',
  ]
    .filter(Boolean)
    .join(' | ');

  const nodes: GraphNode[] = graph.nodes.map((n) => {
    if (n.type !== 'generate') return n;
    const cfg = { ...(n.config ?? {}) } as Record<string, unknown>;
    const prevPrompt = typeof cfg.prompt === 'string' ? cfg.prompt : '';
    cfg.prompt = prevPrompt ? `${prevPrompt}\n${suffix}` : suffix;
    cfg.variantCode = args.variantCode;
    cfg.variantComponents = args.components;
    return { ...n, config: cfg };
  });

  return { ...graph, nodes };
}

export function estimateVariantBatchMicrounits(variantCount: number, slotsPerVariant = 7): number {
  const unit = amountToMicrounits(FAKE_PRIMARY_MODEL.pricing.estimatedUnitCost);
  return unit * variantCount * slotsPerVariant;
}

export function assertVariantBatchBudget(args: {
  variantCount: number;
  slotsPerVariant?: number;
  budgetLimit?: BudgetLimit | null;
  confirmBudget?: boolean;
}): { ok: true; estimateMicrounits: number } | { ok: false; reason: string; estimateMicrounits: number } {
  const slots = args.slotsPerVariant ?? 7;
  const estimateMicrounits = estimateVariantBatchMicrounits(args.variantCount, slots);
  if (
    budgetExceeded(
      {
        currency: FAKE_PRIMARY_MODEL.pricing.currency,
        estimatedMicrounits: estimateMicrounits,
        unitCount: args.variantCount * slots,
      },
      args.budgetLimit,
    ) &&
    !args.confirmBudget
  ) {
    return {
      ok: false,
      reason: 'Estimated cost exceeds budgetLimit; pass confirmBudget=true to proceed',
      estimateMicrounits,
    };
  }
  return { ok: true, estimateMicrounits };
}

export function aggregateVariantRunStatus(
  itemStatuses: ReadonlyArray<VariantItemStatus>,
): VariantRunStatus {
  if (itemStatuses.length === 0) return 'QUEUED';
  const terminalFail = new Set(['FAILED_FINAL', 'QA_BLOCK']);
  const successish = new Set(['SUCCEEDED', 'QA_PASS', 'QA_REVIEW', 'SKIPPED']);
  const running = itemStatuses.some((s) => s === 'RUNNING' || s === 'QUEUED' || s === 'PENDING');
  if (running) return 'RUNNING';
  const anyFail = itemStatuses.some((s) => terminalFail.has(s) || s === 'FAILED_RETRYABLE');
  const anySuccess = itemStatuses.some((s) => successish.has(s));
  if (anyFail && anySuccess) return 'PARTIAL';
  if (anyFail) return 'FAILED';
  return 'SUCCEEDED';
}

/** Map Fake Vision scenario → whether structure/logo locks should BLOCK/REVIEW. */
export function variantLockQaExpectation(
  scenario: string | undefined,
): { overall: 'PASS' | 'REVIEW' | 'BLOCK'; reason: string } {
  const s = (scenario ?? 'SUCCESS').toUpperCase();
  if (s === 'STRUCTURE_CHANGE' || s === 'IDENTITY_MISMATCH' || s === 'LOGO_CHANGE') {
    return { overall: 'BLOCK', reason: `Variant lock violation scenario ${s}` };
  }
  if (s === 'COMPOSITION_DRIFT' || s === 'ATTACHMENT_COUNT') {
    return { overall: 'REVIEW', reason: `Variant soft lock scenario ${s}` };
  }
  return { overall: 'PASS', reason: 'Variant locks held' };
}

/** Export filter: keep only items that passed QA (and optionally REVIEW if allowReview). */
export function filterExportableVariantItems<T extends { status: VariantItemStatus }>(
  items: ReadonlyArray<T>,
  opts?: { allowReview?: boolean },
): T[] {
  return items.filter((it) => {
    if (it.status === 'QA_PASS' || it.status === 'SUCCEEDED') return true;
    if (opts?.allowReview && it.status === 'QA_REVIEW') return true;
    return false;
  });
}

export function buildVariantManifestEntry(args: {
  variantCode: string;
  slot: string;
  outputIndex: number;
  assetVersionId: string | null;
  qaReportId: string | null;
  status: VariantItemStatus;
  path?: string;
}): Record<string, unknown> {
  return {
    variantCode: args.variantCode,
    slot: args.slot,
    outputIndex: args.outputIndex,
    assetVersionId: args.assetVersionId,
    qaReportId: args.qaReportId,
    status: args.status,
    path: args.path ?? null,
  };
}
