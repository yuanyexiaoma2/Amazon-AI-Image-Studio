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

export type ModelCapabilities = {
  /** 文生图：无参考图也能出图。 */
  t2i: boolean;
  /** 图生图：可接收参考图。 */
  i2i: boolean;
};

export type ModelRegistryEntry = {
  key: string;
  provider: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  operations: ImageOperation[];
  /** 文生图/图生图分面（kie 的 *-text-to-image 条目 t2i-only，*-image-to-image 条目 i2i-only）。 */
  capabilities: ModelCapabilities;
  /** 人类可读的中文使用约束说明，供 UI 展示。 */
  rules?: string[];
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
  capabilities: { t2i: true, i2i: true },
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
  capabilities: { t2i: false, i2i: true },
};

export const DEFAULT_MODEL_REGISTRY: ModelRegistryEntry[] = [
  FAKE_PRIMARY_MODEL,
  FAKE_EDIT_MODEL,
  FAKE_UPSCALE_MODEL,
];


/**
 * Google Nano Banana 2（docs.kie.ai/market/google/nanobanana2，OpenAPI 确认）。
 * 单一 modelId 文生图/图生图合一（image_input ≤14 张，30MB/张；传空即纯文生图）。
 * 比例比 Pro 多 1:4/4:1/1:8/8:1 极端档；文档无比例×分辨率组合限制。
 * 价格（第三方双源）：1K≈$0.04、2K≈$0.06、4K≈$0.09；estimatedUnitCost 取 2K 档。
 */
export const KIE_NANO_BANANA_2_MODEL: ModelRegistryEntry = {
  key: 'kie-nano-banana-2',
  provider: 'kie',
  modelId: 'nano-banana-2',
  displayName: 'Google Nano Banana 2',
  enabled: true,
  operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'REMOVE_BACKGROUND'],
  capabilities: { t2i: true, i2i: true },
  // 文档另支持 'auto'（模型自选比例），UI 只给显式比例。
  ratios: ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9'],
  resolutionTiers: ['1K', '2K', '4K'],
  maxReferenceImages: 14,
  maxOutputs: 4,
  supportsSeed: false,
  supportsWebhook: true,
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.06 },
  configVersion: 1,
};

/**
 * Google Nano Banana 2 Lite（docs.kie.ai/market/google/nano-banana-2-lite，OpenAPI 确认）。
 * 注意：参考图参数是 image_urls（≤10 张），与 nb-pro/nb2 的 image_input 不同；
 * 无 resolution / output_format 参数（只出 1K）；aspect_ratio 在 schema 里 required，调用时显式传。
 * 价格 kie 官方未确认（上游 Google 官价 ≈$0.034/张）；estimatedUnitCost 为占位 $0.04。
 */
export const KIE_NANO_BANANA_2_LITE_MODEL: ModelRegistryEntry = {
  key: 'kie-nano-banana-2-lite',
  provider: 'kie',
  modelId: 'nano-banana-2-lite',
  displayName: 'Google Nano Banana 2 Lite',
  enabled: true,
  operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'REMOVE_BACKGROUND'],
  capabilities: { t2i: true, i2i: true },
  rules: ['只出 1K 图，无分辨率档位可选'],
  ratios: ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9'],
  resolutionTiers: ['1K'],
  maxReferenceImages: 10,
  maxOutputs: 4,
  supportsSeed: false,
  supportsWebhook: true,
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.04 },
  configVersion: 1,
};

/**
 * GPT Image 2.5（docs.kie.ai/market/gpt/ 下四个端点，OpenAPI 确认）。
 * Flare=速度档 / Sunburst=精度档，各分 t2i/i2i；i2i 用 input_urls ≤16 张。
 * 组合限制仅「27:16、16:27、9:8、8:9 只支持 1K」——登记时直接剔除这四个和 auto，
 * 其余 8 档比例 1K/2K/4K 全兼容（比 gpt-image-2 宽松：1:1 可 4K、auto 可 4K）。
 * 价格：kie 官方未确认；第三方实测 1K≈$0.03；estimatedUnitCost 保守占位 $0.05。
 */
const GPT_IMAGE_2_5_BASE: Pick<
  ModelRegistryEntry,
  | 'provider'
  | 'enabled'
  | 'ratios'
  | 'resolutionTiers'
  | 'maxOutputs'
  | 'supportsSeed'
  | 'supportsWebhook'
  | 'pricing'
  | 'configVersion'
> = {
  provider: 'kie',
  enabled: true,
  ratios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
  resolutionTiers: ['1K', '2K', '4K'],
  maxOutputs: 4,
  supportsSeed: false,
  supportsWebhook: true,
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.05 },
  configVersion: 1,
};

export const KIE_GPT_IMAGE_2_5_FLARE_GENERATE: ModelRegistryEntry = {
  ...GPT_IMAGE_2_5_BASE,
  key: 'kie-gpt-image-2-5-flare-generate',
  modelId: 'gpt-image-2-5-flare-text-to-image',
  displayName: 'GPT Image 2.5 Flare (text-to-image)',
  operations: ['GENERATE'],
  capabilities: { t2i: true, i2i: false },
  rules: ['该模型只支持纯文生图，不能连接参考图'],
  maxReferenceImages: 0,
};

export const KIE_GPT_IMAGE_2_5_FLARE_EDIT: ModelRegistryEntry = {
  ...GPT_IMAGE_2_5_BASE,
  key: 'kie-gpt-image-2-5-flare-edit',
  modelId: 'gpt-image-2-5-flare-image-to-image',
  displayName: 'GPT Image 2.5 Flare (image-to-image)',
  operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'REMOVE_BACKGROUND'],
  capabilities: { t2i: false, i2i: true },
  rules: ['该模型必须连接参考图（图生图）'],
  maxReferenceImages: 16,
};

export const KIE_GPT_IMAGE_2_5_SUNBURST_GENERATE: ModelRegistryEntry = {
  ...GPT_IMAGE_2_5_BASE,
  key: 'kie-gpt-image-2-5-sunburst-generate',
  modelId: 'gpt-image-2-5-sunburst-text-to-image',
  displayName: 'GPT Image 2.5 Sunburst (text-to-image)',
  operations: ['GENERATE'],
  capabilities: { t2i: true, i2i: false },
  rules: ['该模型只支持纯文生图，不能连接参考图'],
  maxReferenceImages: 0,
};

export const KIE_GPT_IMAGE_2_5_SUNBURST_EDIT: ModelRegistryEntry = {
  ...GPT_IMAGE_2_5_BASE,
  key: 'kie-gpt-image-2-5-sunburst-edit',
  modelId: 'gpt-image-2-5-sunburst-image-to-image',
  displayName: 'GPT Image 2.5 Sunburst (image-to-image)',
  operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'REMOVE_BACKGROUND'],
  capabilities: { t2i: false, i2i: true },
  rules: ['该模型必须连接参考图（图生图）'],
  maxReferenceImages: 16,
};

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
  capabilities: { t2i: true, i2i: true },
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
  capabilities: { t2i: true, i2i: false },
  rules: ['该模型只支持纯文生图，不能连接参考图'],
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
  capabilities: { t2i: false, i2i: true },
  rules: ['该模型必须连接参考图（图生图）'],
  ratios: ['1:1', '9:16', '16:9', '4:3', '3:4'],
  resolutionTiers: ['1K', '2K'],
  maxReferenceImages: 16,
  maxOutputs: 4,
  supportsSeed: false,
  supportsWebhook: true,
  pricing: { currency: 'USD', unit: 'image', estimatedUnitCost: 0.05 },
  configVersion: 1,
};

export const KIE_MODEL_REGISTRY: ModelRegistryEntry[] = [
  KIE_NANO_BANANA_2_MODEL,
  KIE_NANO_BANANA_2_LITE_MODEL,
  KIE_GPT_IMAGE_2_5_FLARE_GENERATE,
  KIE_GPT_IMAGE_2_5_FLARE_EDIT,
  KIE_GPT_IMAGE_2_5_SUNBURST_GENERATE,
  KIE_GPT_IMAGE_2_5_SUNBURST_EDIT,
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

/**
 * 「智能匹配」节点模型取值：config.modelKey === 'auto' 时由运行时按输入解析——
 * 编辑类操作或连了参考图 → 图生图/编辑偏好序；否则文生图偏好序。
 * 偏好序体现所有者主力模型（Google Nano Banana 2 / GPT Image 2.5 优先，
 * Nano Banana Pro / GPT Image 2 备选），Fake 用于演示/测试。
 * 找不到偏好项时回退到注册表里第一个可用 GENERATE 模型。
 */
export const AUTO_MODEL_KEY = 'auto';

const AUTO_T2I_PREFERENCE = [
  'kie-nano-banana-2',
  'kie-gpt-image-2-5-flare-generate',
  'kie-nano-banana-pro',
  'kie-gpt-image-2-generate',
  'primary-image-generate',
] as const;

const AUTO_EDIT_PREFERENCE = [
  'kie-nano-banana-2',
  'kie-gpt-image-2-5-flare-edit',
  'kie-nano-banana-pro',
  'kie-gpt-image-2-edit',
  'primary-image-edit',
] as const;

export function resolveAutoModelKey(
  needsReferences: boolean,
  registry: ReadonlyArray<ModelRegistryEntry> = DEFAULT_MODEL_REGISTRY,
): string | undefined {
  const preference = needsReferences ? AUTO_EDIT_PREFERENCE : AUTO_T2I_PREFERENCE;
  for (const key of preference) {
    if (getModelByKey(key, registry)) return key;
  }
  return listEnabledModels(registry, 'GENERATE')[0]?.key;
}

export type ModelRunInput = {
  /** 本次运行是否带参考图（references / image 端口有输入）。 */
  hasReferences: boolean;
  /** 仅对有比例概念的节点（generate / outpaint）传。 */
  ratio?: string;
  /** 仅对有分辨率概念的节点（generate / upscale）传。 */
  resolution?: string;
};

/**
 * 提交前校验：模型能力（t2i/i2i 分面）与比例/分辨率档位。
 * 返回中文错误列表，空数组 = 通过。UI 与 Agent 在提交前调用，
 * db createRun 在落库前再拦一次（GenerationValidationError）。
 */
export function validateModelRunInput(
  entry: ModelRegistryEntry,
  input: ModelRunInput,
): string[] {
  const errors: string[] = [];
  if (!input.hasReferences && !entry.capabilities.t2i) {
    errors.push(`「${entry.displayName}」只支持图生图，必须连接参考图`);
  }
  if (input.hasReferences && !entry.capabilities.i2i) {
    errors.push(`「${entry.displayName}」只支持纯文生图，不能连接参考图`);
  }
  if (input.ratio && !entry.ratios.includes(input.ratio)) {
    errors.push(
      `「${entry.displayName}」不支持比例 ${input.ratio}（可用：${entry.ratios.join('、')}）`,
    );
  }
  if (input.resolution && !entry.resolutionTiers.includes(input.resolution)) {
    errors.push(
      `「${entry.displayName}」不支持清晰度 ${input.resolution}（可用：${entry.resolutionTiers.join('、')}）`,
    );
  }
  return errors;
}
