/**
 * 生图卡与底部提示词条共用的模型/比例/清晰度选项计算。
 * 抽成纯函数，避免节点卡与 PromptBar 两处逻辑漂移。
 */
import type { ModelOptionItem } from './config-options';

export const RESOLUTION_ZH: Record<string, string> = {
  '1K': '标准（1K）',
  '2K': '高清（2K）',
  '4K': '超清（4K）',
};

export const FALLBACK_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];
export const FALLBACK_RESOLUTIONS = ['1K', '2K', '4K'];

/** 智能匹配时的安全档：谷歌/GPT 文生图与图生图三方交集，1K/2K 全兼容。 */
export const AUTO_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];
export const AUTO_RESOLUTIONS = ['1K', '2K'];

export function withCurrentValue(options: string[], current: string): string[] {
  return current && !options.includes(current) ? [current, ...options] : options;
}

export type GenerateOptionSets = {
  models: ModelOptionItem[];
  isAuto: boolean;
  current: ModelOptionItem | undefined;
  ratioOptions: string[];
  resolutionOptions: string[];
};

export function generateOptionSets(
  allModels: ModelOptionItem[] | null,
  modelKey: string,
  ratio: string,
  resolution: string,
): GenerateOptionSets {
  const models = (allModels ?? []).filter((m) => m.operations.includes('GENERATE'));
  const isAuto = modelKey === 'auto' || modelKey === '';
  const current = isAuto ? undefined : models.find((m) => m.key === modelKey);
  return {
    models,
    isAuto,
    current,
    ratioOptions: withCurrentValue(isAuto ? AUTO_RATIOS : (current?.ratios ?? FALLBACK_RATIOS), ratio),
    resolutionOptions: withCurrentValue(
      isAuto ? AUTO_RESOLUTIONS : (current?.resolutionTiers ?? FALLBACK_RESOLUTIONS),
      resolution,
    ),
  };
}
