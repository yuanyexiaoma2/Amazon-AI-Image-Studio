import type { WorkflowCommand } from '@studio/contracts';
import type { WorkflowGraph } from '@studio/domain';

/**
 * Agent 可用卡片标题指代节点：命令里的 nodeId 字段先按 id 精确命中，
 * 否则按节点 config.title 精确匹配；查无/重名时整批拒绝并返回中文说明。
 * addNode.nodeId 是新节点 id，不做解析。
 */

export type ResolveAgentNodeIdsResult =
  | { ok: true; commands: WorkflowCommand[] }
  | { ok: false; message: string };

function nodeTitle(node: WorkflowGraph['nodes'][number]): string {
  const raw = (node.config as Record<string, unknown> | undefined)?.title;
  return typeof raw === 'string' ? raw.trim() : '';
}

function resolveNodeRef(
  ref: string,
  graph: WorkflowGraph,
): { ok: true; nodeId: string } | { ok: false; message: string } {
  if (graph.nodes.some((n) => n.id === ref)) return { ok: true, nodeId: ref };
  const matches = graph.nodes.filter((n) => nodeTitle(n) !== '' && nodeTitle(n) === ref.trim());
  if (matches.length === 1) return { ok: true, nodeId: (matches[0] as (typeof matches)[number]).id };
  if (matches.length > 1) {
    return {
      ok: false,
      message: `画布上有多个名为「${ref}」的卡片（${matches.map((m) => m.id).join('、')}），请改用节点 id 指定`,
    };
  }
  return { ok: false, message: `画布上找不到节点「${ref}」` };
}

export function resolveAgentNodeIds(
  commands: WorkflowCommand[],
  graph: WorkflowGraph,
): ResolveAgentNodeIdsResult {
  const resolved: WorkflowCommand[] = [];
  for (const command of commands) {
    switch (command.type) {
      case 'configure':
      case 'removeNode':
      case 'moveNode': {
        const r = resolveNodeRef(command.nodeId, graph);
        if (!r.ok) return r;
        resolved.push({ ...command, nodeId: r.nodeId });
        break;
      }
      case 'connect': {
        const source = resolveNodeRef(command.source, graph);
        if (!source.ok) return source;
        const target = resolveNodeRef(command.target, graph);
        if (!target.ok) return target;
        resolved.push({ ...command, source: source.nodeId, target: target.nodeId });
        break;
      }
      case 'run': {
        const scope = command.scope;
        if (!scope || scope.type === 'ALL') {
          resolved.push(command);
          break;
        }
        const next = { ...scope };
        if (typeof next.nodeId === 'string') {
          const r = resolveNodeRef(next.nodeId, graph);
          if (!r.ok) return r;
          next.nodeId = r.nodeId;
        }
        if (Array.isArray(next.nodeIds)) {
          const ids: string[] = [];
          for (const ref of next.nodeIds) {
            const r = resolveNodeRef(ref, graph);
            if (!r.ok) return r;
            ids.push(r.nodeId);
          }
          next.nodeIds = ids;
        }
        resolved.push({ ...command, scope: next });
        break;
      }
      default:
        resolved.push(command);
    }
  }
  return { ok: true, commands: resolved };
}
