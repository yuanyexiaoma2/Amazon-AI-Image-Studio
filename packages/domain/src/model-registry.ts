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
 * Google Nano Banana Pro（docs.kie.ai/market/google/pro-image-to-image，OpenAPI 确认）。
 * 单一 modelId 同时支持文生图与图生图（image_input ≤8 张，30MB/张）。
 * 价格：1K/2K ≈ 18 credits、4K ≈ 24 credits（第三方双源印证，kie 官网价格页区域不可达）；
 * estimatedUnitCost 取上限 $0.12 以便预算门保守。
 */
export const KIE_NANO_BANANA_PRO_MODEL: ModelRegistryEntry = {
  key: 'kie-nano-banana-pro',
  provider: 'kie',
  modelId: 'nano-banana-pro',
  displayName: 'Google Nano Banana Pro',
  enabled: true,
  operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'REMOVE_BACKGROUND'],
  // 文档另支持 'auto'（模型自选比例），UI 只给显式比例。
  ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  resolutionTiers: ['1K', '2K', '4K'],
  maxReferenceImages: 8,
  maxOutputs: 4,
  supportsSeed: false,
  supportsWebhook: true,
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.12 },
  configVersion: 1,
};

/**
 * GPT Image 2 文生图（docs.kie.ai/market/gpt/gpt-image-2-text-to-image，OpenAPI 确认）。
 * 文档比例有 16 档但与 resolution 有组合限制（1:1 不能 4K；2K 不支持 5:4/4:5/3:1/1:3/9:21），
 * 这里只登记 1K/2K 全兼容的 7 个常用比例，避免 UI 给出会 400 的组合。
 * 价格官方未确认（callback 示例 creditsConsumed:3）；estimatedUnitCost 为保守占位 $0.05。
 */
export const KIE_GPT_IMAGE_2_GENERATE_MODEL: ModelRegistryEntry = {
  key: 'kie-gpt-image-2-generate',
  provider: 'kie',
  modelId: 'gpt-image-2-text-to-image',
  displayName: 'GPT Image 2 (text-to-image)',
  enabled: true,
  operations: ['GENERATE'],
  ratios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
  resolutionTiers: ['1K', '2K'],
  maxReferenceImages: 0,
  maxOutputs: 4,
  supportsSeed: false,
  supportsWebhook: true,
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.05 },
  configVersion: 1,
};

/**
 * GPT Image 2 图生图（docs.kie.ai/market/gpt/gpt-image-2-image-to-image，OpenAPI 确认）。
 * input_urls ≤16 张（10MB/张）；i2i 可用比例只有 6 档（含 auto），登记 5 个显式比例。
 */
export const KIE_GPT_IMAGE_2_EDIT_MODEL: ModelRegistryEntry = {
  key: 'kie-gpt-image-2-edit',
  provider: 'kie',
  modelId: 'gpt-image-2-image-to-image',
  displayName: 'GPT Image 2 (image-to-image)',
  enabled: true,
  operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'REMOVE_BACKGROUND'],
  ratios: ['1:1', '9:16', '16:9', '4:3', '3:4'],
  resolutionTiers: ['1K', '2K'],
  maxReferenceImages: 16,
  maxOutputs: 4,
  supportsSeed: false,
  supportsWebhook: true,
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.05 },
  configVersion: 1,
};

export const KIE_EXTENDED_MODEL_REGISTRY: ModelRegistryEntry[] = [
  KIE_NANO_BANANA_PRO_MODEL,
  KIE_GPT_IMAGE_2_GENERATE_MODEL,
  KIE_GPT_IMAGE_2_EDIT_MODEL,
];

/**
 * Active registry for the configured IMAGE_PROVIDER.
 * Fake stays available for CI; kie entries use documented Market model IDs only.
 */
export function resolveModelRegistry(
  provider: string = process.env.IMAGE_PROVIDER ?? 'fake',
): ModelRegistryEntry[] {
  const p = provider.trim().toLowerCase();
  if (p === 'kie' || p === 'kie.ai' || p === 'kieai') {
    return [
      ...KIE_MODEL_REGISTRY,
      ...KIE_EXTENDED_MODEL_REGISTRY,
      ...DEFAULT_MODEL_REGISTRY.map((m) => ({ ...m, enabled: false })),
    ];
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
