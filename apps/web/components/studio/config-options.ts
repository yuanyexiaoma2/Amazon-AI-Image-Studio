/**
 * V2 PR-2 — config panel field metadata + pure option builders for the
 * async dropdowns (assets / truth revision / shot briefs / masks / models).
 * Kept free of React/fetch so the builders are unit-testable.
 */

import { zh, REVISION_STATUS_ZH, SLOT_ZH, modelLabelZh } from '@/lib/zh-labels';

export type SelectOption = { value: string; label: string };

export type ConfigFieldSource =
  | 'assets'
  | 'truthRevision'
  | 'shotBriefs'
  | 'masks'
  | 'models';

export type ConfigFieldMeta = {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select' | 'async' | 'textarea';
  /** Static options for kind === 'select'. */
  options?: string[];
  /** Async data source for kind === 'async'. */
  source?: ConfigFieldSource;
  /** Operation filter for source === 'models' (undefined = list all). */
  modelOperation?: 'GENERATE' | 'INPAINT' | 'OUTPAINT' | 'UPSCALE';
  /** Placeholder shown when the field is empty (textarea/text). */
  placeholder?: string;
};

/** PR-6: 4-part scaffold placeholder for the prompt node's text field. */
export const PROMPT_TEXT_PLACEHOLDER = '只改：…\n不改：…\n场景示例：…\n商业约束：…';

export const CONFIG_FIELD_META: Record<string, ConfigFieldMeta[]> = {
  source_image: [
    { key: 'assetVersionId', label: '素材版本', kind: 'async', source: 'assets' },
  ],
  product_truth: [
    { key: 'truthRevisionId', label: '产品图修订', kind: 'async', source: 'truthRevision' },
  ],
  prompt: [
    { key: 'text', label: '提示词', kind: 'textarea', placeholder: PROMPT_TEXT_PLACEHOLDER },
    { key: 'negative', label: '反向提示词', kind: 'text' },
    { key: 'locale', label: '语言地区', kind: 'text' },
    { key: 'shotBriefId', label: '分镜说明', kind: 'async', source: 'shotBriefs' },
    { key: 'slot', label: '槽位', kind: 'text' },
  ],
  remove_background: [
    { key: 'subjectHint', label: '主体提示', kind: 'text' },
    { key: 'edgeMode', label: '边缘模式', kind: 'select', options: ['auto', 'precise', 'soft'] },
  ],
  generate: [
    { key: 'modelKey', label: '模型', kind: 'async', source: 'models', modelOperation: 'GENERATE' },
    {
      key: 'ratio',
      label: '比例',
      kind: 'select',
      options: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9', '4:5'],
    },
    { key: 'resolution', label: '清晰度', kind: 'select', options: ['1K', '2K', '4K'] },
    { key: 'count', label: '数量', kind: 'number' },
    { key: 'seed', label: '种子', kind: 'number' },
  ],
  replace_background: [
    { key: 'fidelity', label: '保真度', kind: 'number' },
    { key: 'lightBlend', label: '光线融合', kind: 'number' },
    { key: 'maskId', label: '蒙版', kind: 'async', source: 'masks' },
  ],
  inpaint: [
    { key: 'strength', label: '强度', kind: 'number' },
    { key: 'modelKey', label: '模型', kind: 'async', source: 'models', modelOperation: 'INPAINT' },
    { key: 'maskId', label: '蒙版', kind: 'async', source: 'masks' },
  ],
  outpaint: [
    { key: 'targetRatio', label: '目标比例', kind: 'text' },
    {
      key: 'placement',
      label: '放置',
      kind: 'select',
      options: ['center', 'top', 'bottom', 'left', 'right'],
    },
    { key: 'modelKey', label: '模型', kind: 'async', source: 'models', modelOperation: 'OUTPAINT' },
  ],
  upscale: [
    { key: 'engineKey', label: '引擎', kind: 'async', source: 'models', modelOperation: 'UPSCALE' },
    { key: 'targetResolution', label: '目标分辨率', kind: 'select', options: ['2K', '4K'] },
  ],
  qa_gate: [{ key: 'policyKey', label: '策略', kind: 'async', source: 'models' }],
  approval_selector: [
    {
      key: 'requiredRole',
      label: '所需角色',
      kind: 'select',
      options: ['OWNER', 'ADMIN', 'MEMBER', 'REVIEWER'],
    },
  ],
  export: [
    { key: 'namingPreset', label: '命名预设', kind: 'text' },
    { key: 'format', label: '格式', kind: 'select', options: ['png', 'jpeg', 'webp'] },
  ],
};

/** Node types that accept a `run` command scoped to NODES. */
export const RUNNABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  'generate',
  'remove_background',
  'replace_background',
  'inpaint',
  'outpaint',
  'upscale',
]);

/** Config keys coerced to Number on edit (matches legacy behavior). */
export const NUMERIC_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'count',
  'seed',
  'fidelity',
  'lightBlend',
  'strength',
]);

/**
 * Config keys whose Zod schema is `.nullable()` — clearing the field means
 * "unset", i.e. `null` (not `''`, which would fail e.g. uuid checks).
 */
export const NULLABLE_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'assetVersionId',
  'truthRevisionId',
  'shotBriefId',
  'slot',
  'maskId',
  'briefSlot',
  'sourcePlanRevisionId',
  'seed',
  'briefOrderIndex',
]);

export type CoercedConfigEdit = { action: 'set'; value: unknown } | { action: 'delete' };

/**
 * PR-6-08 — coerce a raw form-field string into a config value.
 * Empty string is NOT blindly mapped to null: nullable keys get null, numeric
 * keys drop the key (Zod default refills, e.g. count → 2), and plain string
 * keys keep '' (legal per schema). Non-numeric garbage in a numeric field
 * also drops the key so the default applies.
 */
export function coerceConfigValue(key: string, raw: string): CoercedConfigEdit {
  if (raw === '') {
    if (NULLABLE_CONFIG_KEYS.has(key)) return { action: 'set', value: null };
    if (NUMERIC_CONFIG_KEYS.has(key)) return { action: 'delete' };
    return { action: 'set', value: '' };
  }
  if (NUMERIC_CONFIG_KEYS.has(key)) {
    const n = Number(raw);
    return Number.isNaN(n) ? { action: 'delete' } : { action: 'set', value: n };
  }
  return { action: 'set', value: raw };
}

/** Apply one field edit to a config object (non-mutating). */
export function applyConfigEdit(
  prev: Record<string, unknown>,
  key: string,
  raw: string,
): Record<string, unknown> {
  const next = { ...prev };
  const edit = coerceConfigValue(key, raw);
  if (edit.action === 'delete') delete next[key];
  else next[key] = edit.value;
  return next;
}

export const OPTION_LABEL_ZH: Record<string, string> = {
  auto: '自动',
  precise: '精细',
  soft: '柔和',
  center: '居中',
  top: '上',
  bottom: '下',
  left: '左',
  right: '右',
  OWNER: '所有者',
  ADMIN: '管理员',
  MEMBER: '成员',
  REVIEWER: '审核员',
};

export type AssetOptionItem = {
  id: string;
  status: string;
  originalFilename: string | null;
  currentVersionId: string | null;
};

export function buildAssetOptions(items: AssetOptionItem[]): SelectOption[] {
  return items
    .filter((a) => a.currentVersionId && a.status !== 'ARCHIVED')
    .map((a) => {
      const versionId = a.currentVersionId as string;
      return {
        value: versionId,
        label: `${a.originalFilename ?? a.id}（v: ${versionId.slice(0, 8)}…）`,
      };
    });
}

export type TruthRevisionItem = { id: string; revision: number; status: string };

export function buildTruthOptions(revision: TruthRevisionItem | null): SelectOption[] {
  if (!revision) return [];
  return [
    {
      value: revision.id,
      label: `修订 #${revision.revision} · ${zh(REVISION_STATUS_ZH, revision.status)}`,
    },
  ];
}

export type BriefOptionItem = {
  id: string;
  slot: string;
  purpose: string;
  orderIndex: number;
};

export function buildBriefOptions(briefs: BriefOptionItem[]): SelectOption[] {
  return [...briefs]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((b) => ({
      value: b.id,
      label: `#${b.orderIndex} ${zh(SLOT_ZH, b.slot)} · ${b.purpose}`,
    }));
}

export type MaskOptionItem = { id: string; updatedAt: string };

export function buildMaskOptions(masks: MaskOptionItem[]): SelectOption[] {
  return masks.map((m) => ({
    value: m.id,
    label: `蒙版 ${m.id.slice(0, 8)}…（${m.updatedAt.slice(0, 10)}）`,
  }));
}

export type ModelOptionItem = {
  key: string;
  displayName: string;
  operations: string[];
  ratios?: string[];
  resolutionTiers?: string[];
  pricing?: { currency: string; unit: string; estimatedUnitCost: number };
};

export function buildModelOptions(models: ModelOptionItem[], operation?: string): SelectOption[] {
  return models
    .filter((m) => !operation || m.operations.includes(operation))
    .map((m) => ({ value: m.key, label: modelLabelZh(m) }));
}

/** Keep the stored value selectable even when it is not in the fetched list. */
export function withCurrentOption(options: SelectOption[], current: string): SelectOption[] {
  if (!current || options.some((o) => o.value === current)) return options;
  return [{ value: current, label: `当前值：${current.slice(0, 8)}…` }, ...options];
}
