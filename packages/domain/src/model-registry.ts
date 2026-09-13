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

/** Alias used by generate node default config / materialize (W3-B2). */
export const FAKE_EDIT_MODEL: ModelRegistryEntry = {
  ...FAKE_PRIMARY_MODEL,
  key: 'primary-image-edit',
  displayName: 'Fake Primary Product Image (edit alias)',
};

/** Alias for upscale node `engineKey` default (W5-07). */
export const FAKE_UPSCALE_MODEL: ModelRegistryEntry = {
  ...FAKE_PRIMARY_MODEL,
  key: 'default-upscale',
  displayName: 'Fake Default Upscale Engine',
  operations: ['UPSCALE'],
};

export const DEFAULT_MODEL_REGISTRY: ModelRegistryEntry[] = [
  FAKE_PRIMARY_MODEL,
  FAKE_EDIT_MODEL,
  FAKE_UPSCALE_MODEL,
];


/** Documented kie.ai Market model IDs — pricing from docs examples × $0.005/credit. */
export const KIE_GENERATE_MODEL: ModelRegistryEntry = {
  key: 'kie-seedream-5-pro-generate',
  provider: 'kie',
  modelId: 'seedream/5-pro-text-to-image',
  displayName: 'Kie Seedream 5 Pro (text-to-image)',
  enabled: true,
  operations: ['GENERATE'],
  ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
  resolutionTiers: ['1K', '2K'],
  maxReferenceImages: 0,
  maxOutputs: 4,
  supportsSeed: false,
  supportsWebhook: true,
  // 7 credits (docs callback example) × $0.005/credit (kie billing UI) = $0.035
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.035 },
  configVersion: 1,
};

export const KIE_EDIT_MODEL: ModelRegistryEntry = {
  key: 'kie-seedream-5-pro-edit',
  provider: 'kie',
  modelId: 'seedream/5-pro-image-to-image',
  displayName: 'Kie Seedream 5 Pro (image-to-image)',
  enabled: true,
  operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'UPSCALE', 'REMOVE_BACKGROUND'],
  ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
  resolutionTiers: ['1K', '2K'],
  maxReferenceImages: 10,
  maxOutputs: 4,
  supportsSeed: false,
  supportsWebhook: true,
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.035 },
  configVersion: 1,
};

export const KIE_MODEL_REGISTRY: ModelRegistryEntry[] = [KIE_GENERATE_MODEL, KIE_EDIT_MODEL];

/**
 * Active registry for the configured IMAGE_PROVIDER.
 * Fake stays available for CI; kie entries use documented Market model IDs only.
 */
export function resolveModelRegistry(
  provider: string = process.env.IMAGE_PROVIDER ?? 'fake',
): ModelRegistryEntry[] {
  const p = provider.trim().toLowerCase();
  if (p === 'kie' || p === 'kie.ai' || p === 'kieai') {
    return [...KIE_MODEL_REGISTRY, ...DEFAULT_MODEL_REGISTRY.map((m) => ({ ...m, enabled: false }))];
  }
  return DEFAULT_MODEL_REGISTRY;
}

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
