import type { WorkflowCommand } from '@studio/contracts';

/** Agent 允许新建的卡片类型（V2 PR-7 palette 三卡）。 */
const ALLOWED_NODE_TYPES = new Set(['source_image', 'prompt', 'generate']);

/** Agent 允许的命令类型；rename 等其他类型直接丢弃。 */
const ALLOWED_COMMAND_TYPES = new Set([
  'addNode',
  'connect',
  'disconnect',
  'configure',
  'moveNode',
  'removeNode',
  'run',
]);

export type AgentCommandGuardResult =
  | { ok: true; commands: WorkflowCommand[]; droppedTypes: string[] }
  | { ok: false; message: string };

/**
 * Agent 命令白名单（V2 PR-4 安全门）：
 * - 一批最多删除 2 张卡片，超过则整批拒绝（删除不可逆，宁可保守）；
 * - 不在白名单的命令类型 / 非三卡的 addNode 静默丢弃并记录。
 */
export function guardAgentCommands(commands: WorkflowCommand[]): AgentCommandGuardResult {
  const removeCount = commands.filter((c) => c.type === 'removeNode').length;
  if (removeCount > 2) {
    return { ok: false, message: '一次最多删除 2 张卡片，请分批操作' };
  }
  const kept: WorkflowCommand[] = [];
  const droppedTypes: string[] = [];
  for (const command of commands) {
    if (!ALLOWED_COMMAND_TYPES.has(command.type)) {
      droppedTypes.push(command.type);
      continue;
    }
    if (command.type === 'addNode' && !ALLOWED_NODE_TYPES.has(command.nodeType)) {
      droppedTypes.push(`addNode(${command.nodeType})`);
      continue;
    }
    kept.push(command);
  }
  return { ok: true, commands: kept, droppedTypes };
}
