import { describe, expect, it } from 'vitest';
import type { WorkflowCommand } from '@studio/contracts';
import { guardAgentCommands } from '../lib/agent-command-guard';

describe('guardAgentCommands（Agent 命令白名单）', () => {
  it('白名单内的命令全部保留，droppedTypes 为空', () => {
    const commands: WorkflowCommand[] = [
      { type: 'addNode', nodeType: 'source_image', position: { x: 0, y: 0 } },
      { type: 'addNode', nodeType: 'prompt', position: { x: 100, y: 0 } },
      { type: 'addNode', nodeType: 'generate', position: { x: 200, y: 0 } },
      { type: 'connect', source: 'a', target: 'b' },
      { type: 'disconnect', edgeId: 'e1' },
      { type: 'configure', nodeId: 'g', config: { prompt: 'x' } },
      { type: 'moveNode', nodeId: 'g', position: { x: 1, y: 2 } },
      { type: 'removeNode', nodeId: 'g' },
      { type: 'run', scope: { type: 'ALL' }, confirmBudget: true, idempotencyKey: 'k1' },
    ];
    const result = guardAgentCommands(commands);
    expect(result).toEqual({ ok: true, commands, droppedTypes: [] });
  });

  it('一次删除超过 2 张卡片 → 整批拒绝', () => {
    const result = guardAgentCommands([
      { type: 'removeNode', nodeId: 'a' },
      { type: 'removeNode', nodeId: 'b' },
      { type: 'removeNode', nodeId: 'c' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('最多删除 2 张卡片');
    }
  });

  it('恰好删除 2 张卡片 → 放行', () => {
    const commands: WorkflowCommand[] = [
      { type: 'removeNode', nodeId: 'a' },
      { type: 'removeNode', nodeId: 'b' },
    ];
    const result = guardAgentCommands(commands);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.commands).toHaveLength(2);
  });

  it('rename 等非白名单类型 → 丢弃并记录', () => {
    const result = guardAgentCommands([
      { type: 'rename', name: '新名字' },
      { type: 'moveNode', nodeId: 'g', position: { x: 0, y: 0 } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commands).toHaveLength(1);
      expect(result.droppedTypes).toEqual(['rename']);
    }
  });

  it('非三卡的 addNode → 丢弃并记录节点类型', () => {
    const result = guardAgentCommands([
      { type: 'addNode', nodeType: 'qa_gate', position: { x: 0, y: 0 } },
      { type: 'addNode', nodeType: 'prompt', position: { x: 0, y: 0 } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commands).toHaveLength(1);
      expect(result.droppedTypes).toEqual(['addNode(qa_gate)']);
    }
  });
});
