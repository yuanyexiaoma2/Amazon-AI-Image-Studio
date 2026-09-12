/**
 * Model Registry entries (spec §9.2). Server-owned; UI filters by operation.
 */

export type ImageOperation =
  | 'GENERATE'
  | 'EDIT'
  | 'INPAINT'
  | 'OUTPAINT'
  | 'UPSCALE'
  | 'REMOVE_BACKGROUND'
  | 'VISION_ANALYZE';

export type ModelRegistryEntry = {
  key: string;
  provider: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  operations: ImageOperation[];
  ratios: string[];
  resolutionTiers: string[];
  maxReferenceImages: number;
  maxOutputs: number;
  supportsSeed: boolean;
  supportsWebhook: boolean;
  pricing: {
    currency: string;
    unit: string;
    estimatedUnitCost: number;
  };
  configVersion: number;
};

/** Built-in Fake primary model — only registry until W0-02 unblocked. */
export const FAKE_PRIMARY_MODEL: ModelRegistryEntry = {
  key: 'primary-image-generate',
  provider: 'fake',
  modelId: 'fake-v1',
  displayName: 'Fake Primary Product Image',
  enabled: true,
  operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'UPSCALE', 'REMOVE_BACKGROUND'],
  ratios: ['1:1', '4:5', '3:4', '16:9'],
  resolutionTiers: ['1K', '2K', '4K'],
  maxReferenceImages: 8,
  maxOutputs: 4,
  supportsSeed: true,
  supportsWebhook: true,
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.01 },
  configVersion: 1,
};

export const DEFAULT_MODEL_REGISTRY: ModelRegistryEntry[] = [FAKE_PRIMARY_MODEL];

export function listEnabledModels(
  registry: ReadonlyArray<ModelRegistryEntry> = DEFAULT_MODEL_REGISTRY,
  operation?: ImageOperation,
): ModelRegistryEntry[] {
  return registry.filter(
    (m) => m.enabled && (!operation || m.operations.includes(operation)),
  );
}

export function getModelByKey(
  key: string,
  registry: ReadonlyArray<ModelRegistryEntry> = DEFAULT_MODEL_REGISTRY,
): ModelRegistryEntry | undefined {
  return registry.find((m) => m.key === key && m.enabled);
}
