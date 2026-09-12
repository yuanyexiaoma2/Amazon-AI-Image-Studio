import type { VariantDetail, VariantRunDetail } from '@studio/db';

type VariantItemLike = {
  id: string;
  variantId: string;
  variantRunId: string | null;
  slot: string;
  outputIndex: number;
  status: string;
  generationItemId: string | null;
  selectedAssetVersionId: string | null;
  qaReportId: string | null;
  errorClass: string | null;
  errorMessage: string | null;
};

function locks(json: unknown): string[] {
  return Array.isArray(json) ? json.map(String) : [];
}

export function serializeVariant(v: VariantDetail) {
  return {
    id: v.id,
    projectId: v.projectId,
    code: v.code,
    displayName: v.displayName,
    masterVariantId: v.masterVariantId,
    status: v.status,
    workflowId: v.workflowId,
    components: v.components.map((c) => ({
      id: c.id,
      componentKey: c.componentKey,
      colorHex: c.colorHex,
      colorDescription: c.colorDescription,
      material: c.material,
      locks: locks(c.locksJson),
      allowedChanges: locks(c.allowedChangesJson),
    })),
    createdAt: v.createdAt.toISOString(),
  };
}

export function serializeVariantItem(it: VariantItemLike) {
  return {
    id: it.id,
    variantId: it.variantId,
    variantRunId: it.variantRunId,
    slot: it.slot,
    outputIndex: it.outputIndex,
    status: it.status,
    generationItemId: it.generationItemId,
    selectedAssetVersionId: it.selectedAssetVersionId,
    qaReportId: it.qaReportId,
    errorClass: it.errorClass,
    errorMessage: it.errorMessage,
  };
}

export function serializeVariantRun(run: VariantRunDetail) {
  return {
    id: run.id,
    projectId: run.projectId,
    masterVariantId: run.masterVariantId,
    status: run.status,
    estimateMicrounits: run.estimateMicrounits,
    currency: run.currency,
    confirmBudget: run.confirmBudget,
    items: run.items.map(serializeVariantItem),
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}
