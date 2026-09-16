/**
 * V2 PR-6-07 — 全界面中文化：把数据层枚举值（运行状态 / 素材状态 / 修订状态 /
 * 质检结论 / 决策 / 角色 / 槽位 / 命令类型）渲染成通俗中文。
 * 未收录的原始值原样返回（多为服务端生成的诊断信息或用户数据）。
 */

export function zh(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}

export const RUN_STATUS_ZH: Record<string, string> = {
  QUEUED: '排队中',
  RUNNING: '运行中',
  SUCCEEDED: '成功',
  FAILED: '失败',
  FAILED_RETRYABLE: '失败（可重试）',
  FAILED_FINAL: '失败（已终止）',
  CANCELLED: '已取消',
  PENDING: '等待中',
};

export const ASSET_STATUS_ZH: Record<string, string> = {
  UPLOADING: '上传中',
  PROCESSING: '处理中',
  READY: '就绪',
  REJECTED: '未通过检查',
  ARCHIVED: '已归档',
};

export const REVISION_STATUS_ZH: Record<string, string> = {
  DRAFT: '草稿',
  EXTRACTED: '待确认',
  CONFIRMED: '已确认',
  PENDING_REVIEW: '待审核',
  APPROVED: '已批准',
  SUPERSEDED: '已作废',
};

export const QA_OVERALL_ZH: Record<string, string> = {
  PASS: '通过',
  REVIEW: '待人工复核',
  BLOCK: '不通过',
};

export const QA_FINDING_STATUS_ZH: Record<string, string> = {
  PASS: '通过',
  REVIEW: '待人工复核',
  FAIL: '不通过',
};

export const QA_SEVERITY_ZH: Record<string, string> = {
  LOW: '轻度',
  MEDIUM: '中等',
  HIGH: '严重',
  CRITICAL: '致命',
};

export const DECISION_ZH: Record<string, string> = {
  APPROVE: '通过',
  REJECT: '驳回',
  OVERRIDE_BLOCK: '强制通过',
  REVOKE: '撤销',
};

export const ROLE_ZH: Record<string, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  MEMBER: '成员',
  REVIEWER: '审核员',
};

export const SLOT_ZH: Record<string, string> = {
  MAIN: '主图',
  FEATURE: '卖点图',
  DETAIL: '细节图',
  DIMENSION: '尺寸图',
  LIFESTYLE: '场景图',
  PACKAGE: '包装图',
  hero: '主图',
  'selling-point': '卖点图',
  lifestyle: '场景图',
  detail: '细节图',
};

export const COMMAND_TYPE_ZH: Record<string, string> = {
  addNode: '添加节点',
  removeNode: '删除节点',
  moveNode: '移动节点',
  configure: '修改参数',
  connect: '连线',
  disconnect: '断开连线',
  rename: '重命名',
  run: '运行',
};

export const PROVIDER_ZH: Record<string, string> = {
  fake: '演示',
};

/** 生图模型 key → 中文显示名（模型品牌名保留原文）。 */
export const MODEL_KEY_ZH: Record<string, string> = {
  'primary-image-generate': '演示模型（文生图）',
  'primary-image-edit': '演示模型（图片编辑）',
  'default-upscale': '演示引擎（高清放大）',
  'kie-seedream-5-pro-generate': 'Seedream 5 Pro（文生图）',
  'kie-seedream-5-pro-edit': 'Seedream 5 Pro（图片编辑）',
};

export function modelLabelZh(model: { key: string; displayName?: string }): string {
  return MODEL_KEY_ZH[model.key] ?? model.displayName ?? model.key;
}

export const EXPORT_STATUS_ZH: Record<string, string> = {
  PENDING: '处理中',
  READY: '就绪',
  BLOCKED: '已阻止',
  FAILED: '失败',
};

/** Node type ids → 通俗中文（画布节点卡片 + 报错文案共用）。 */
export const NODE_TYPE_ZH: Record<string, string> = {
  source_image: '参考图',
  product_truth: '产品图',
  prompt: '提示词',
  remove_background: '抠图',
  generate: '生成',
  replace_background: '换背景',
  inpaint: '局部重绘',
  outpaint: '扩图',
  upscale: '高清放大',
  qa_gate: '质检',
  approval_selector: '人工挑选',
  export: '导出',
};

/** Node config field keys → 中文（报错文案里的字段名）。 */
export const CONFIG_FIELD_ZH: Record<string, string> = {
  text: '提示词内容',
  negative: '反向提示词',
  locale: '语言地区',
  slot: '槽位',
  count: '数量',
  seed: '种子',
  fidelity: '保真度',
  lightBlend: '光线融合',
  strength: '强度',
  ratio: '比例',
  resolution: '分辨率',
  modelKey: '模型',
  engineKey: '引擎',
  targetResolution: '目标分辨率',
  targetRatio: '目标比例',
  placement: '放置',
  policyKey: '策略',
  assetVersionId: '素材版本',
  truthRevisionId: '产品图修订',
  shotBriefId: '分镜说明',
  maskId: '蒙版',
  namingPreset: '命名预设',
  format: '格式',
  requiredRole: '所需角色',
  subjectHint: '主体提示',
  edgeMode: '边缘模式',
  briefSlot: '分镜槽位',
  briefOrderIndex: '分镜顺序',
  sourcePlanRevisionId: '来源分镜修订',
  schemaVersion: '配置版本',
};

/**
 * Command 错误码 → 中文。只收录真实存在的码：
 * domain WorkflowCommandErrorCode（packages/domain/src/workflow-commands.ts）
 * 及其包含的 GraphIssueCode（packages/domain/src/workflow-graph.ts）。
 */
export const COMMAND_ERROR_CODE_ZH: Record<string, string> = {
  INVALID_NODE_CONFIG: '节点配置不正确',
  NODE_NOT_FOUND: '节点不存在',
  EDGE_NOT_FOUND: '连线不存在',
  RUN_NOT_LAST: '运行命令必须放在最后',
  DUPLICATE_NODE_ID: '节点编号重复',
  DUPLICATE_EDGE_ID: '连线编号重复',
  NODE_TYPE_NOT_IN_PALETTE: '该节点类型不能手动添加',
  UNKNOWN_NODE_TYPE: '未知的节点类型',
  UNKNOWN_SOURCE_HANDLE: '未知的输出端口',
  UNKNOWN_TARGET_HANDLE: '未知的输入端口',
  PORT_TYPE_MISMATCH: '端口类型不匹配',
  SELF_LOOP: '节点不能连自己',
  DUPLICATE_EDGE: '连线重复',
  CROSS_LAYER_BACK_EDGE: '不允许从后往前连线',
  CYCLE: '连线会形成循环',
  MULTI_INCOMING: '该端口只能连一条线',
  MISSING_NODE: '连线指向了不存在的节点',
  EXPORT_REQUIRES_APPROVED: '导出前需要先通过人工挑选',
};

const RECEIVED_ZH: Record<string, string> = {
  null: '空值',
  undefined: '空值',
  number: '数字',
  string: '文字',
  boolean: '布尔值',
  array: '数组',
  object: '对象',
};

/** Common Zod issue messages → 中文；返回 null 表示没有匹配的已知模式。 */
function zodMessageZh(message: string): string | null {
  let m = /^Expected (\w+), received (\w+)$/.exec(message);
  if (m) {
    const expected = m[1] === 'string' ? '文字' : m[1] === 'number' ? '数字' : m[1];
    return `需要${expected}，收到了${RECEIVED_ZH[m[2]] ?? m[2]}`;
  }
  m = /^String must contain at most (\d+) character/.exec(message);
  if (m) return `最多 ${m[1]} 个字`;
  m = /^String must contain at least (\d+) character/.exec(message);
  if (m) return `至少 ${m[1]} 个字`;
  m = /^Number must be greater than or equal to (.+)$/.exec(message);
  if (m) return `不能小于 ${m[1]}`;
  m = /^Number must be less than or equal to (.+)$/.exec(message);
  if (m) return `不能大于 ${m[1]}`;
  if (/^Number must be an integer$/.test(message)) return '必须是整数';
  if (/^Invalid uuid$/i.test(message)) return '需要选择一项（编号格式不对）';
  if (/^Invalid enum value\./.test(message)) return '选项不在允许范围内';
  if (/^Required$/.test(message)) return '必填项缺失';
  return null;
}

/** `text: Expected string, received null` → `提示词内容：需要文字，收到了空值`。 */
function configIssueZh(issue: string): string {
  const m = /^([\w.]*): ([\s\S]+)$/.exec(issue);
  if (!m) return `配置未通过检查：${issue}`;
  const field = m[1] ? (CONFIG_FIELD_ZH[m[1]] ?? m[1]) : '配置';
  const reason = zodMessageZh(m[2]);
  return reason ? `${field}：${reason}` : `配置未通过检查：${issue}`;
}

/**
 * PR-6-08 — 把服务端 command 报错（`command[0] (CODE): …` 机器前缀 + 英文
 * zod 消息）翻成给用户看的中文。无法识别的内容保留原文。
 */
export function formatCommandErrorZh(message: string): string {
  const head = /^command\[(\d+)\] \(([A-Z_]+)\): ([\s\S]+)$/.exec(message);
  if (!head) return message;
  const code = head[2];
  const detail = head[3];
  const codeZh = COMMAND_ERROR_CODE_ZH[code] ?? code;
  const cfg = /^Invalid config for ([\w-]+): ([\s\S]+)$/.exec(detail);
  if (code === 'INVALID_NODE_CONFIG' && cfg) {
    const nodeZh = NODE_TYPE_ZH[cfg[1]] ?? cfg[1];
    const issues = cfg[2]
      .split('; ')
      .map(configIssueZh)
      .join('；');
    return `${codeZh}（${nodeZh}）— ${issues}`;
  }
  return `${codeZh} — ${detail}`;
}
