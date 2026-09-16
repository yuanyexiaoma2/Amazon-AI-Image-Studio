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

export const EXPORT_STATUS_ZH: Record<string, string> = {
  PENDING: '处理中',
  READY: '就绪',
  BLOCKED: '已阻止',
  FAILED: '失败',
};
