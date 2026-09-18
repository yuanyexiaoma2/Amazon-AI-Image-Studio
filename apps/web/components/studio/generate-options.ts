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

/**
 * 模型 × 参考图连线兼容性：返回禁用原因（null = 可用）。
 * t2i-only 模型在已连参考图时禁用；i2i-only 模型在无参考图时禁用。
 */
export function modelDisabledReason(m: ModelOptionItem, hasReferences: boolean): string | null {
  const caps = m.capabilities;
  if (!caps) return null;
  if (hasReferences && !caps.i2i) return '该模型不支持参考图';
  if (!hasReferences && !caps.t2i) return '该模型必须连接参考图';
  return null;
}

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
