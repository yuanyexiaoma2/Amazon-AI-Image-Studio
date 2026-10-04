import { describe, expect, it } from 'vitest';
import type { WorkflowCommand } from '@studio/contracts';
import type { WorkflowGraph } from '@studio/domain';
import { resolveAgentNodeIds } from '../lib/resolve-agent-node-ids';

function node(id: string, type: string, title?: string): WorkflowGraph['nodes'][number] {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    config: { schemaVersion: 1, ...(title !== undefined ? { title } : {}) },
  };
}

const graph: WorkflowGraph = {
  schemaVersion: 1,
  nodes: [
    node('n-src', 'source_image', '产品主图'),
    node('n-prompt', 'prompt', '白底图文案'),
    node('n-gen', 'generate', '白底图'),
    node('n-gen2', 'generate'),
  ],
  edges: [],
};

describe('resolveAgentNodeIds（@卡片名定位）', () => {
  it('id 精确命中时不做改动', () => {
    const commands: WorkflowCommand[] = [
      { type: 'configure', nodeId: 'n-gen', config: { prompt: 'x' } },
    ];
    const result = resolveAgentNodeIds(commands, graph);
    expect(result).toEqual({ ok: true, commands });
  });

  it('标题精确匹配 → 重映射为节点 id', () => {
    const result = resolveAgentNodeIds(
      [
        { type: 'configure', nodeId: '白底图', config: { prompt: 'x' } },
        { type: 'connect', source: '产品主图', target: '白底图', targetHandle: 'references' },
        { type: 'removeNode', nodeId: '白底图文案' },
      ],
      graph,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commands[0]).toMatchObject({ nodeId: 'n-gen' });
      expect(result.commands[1]).toMatchObject({ source: 'n-src', target: 'n-gen' });
      expect(result.commands[2]).toMatchObject({ nodeId: 'n-prompt' });
    }
  });

  it('run scope 的 nodeId / nodeIds 一并重映射', () => {
    const result = resolveAgentNodeIds(
      [
        {
          type: 'run',
          scope: { type: 'NODES', nodeId: '白底图', nodeIds: ['白底图', 'n-gen2'] },
          confirmBudget: true,
          idempotencyKey: 'k1',
        },
      ],
      graph,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const run = result.commands[0] as Extract<WorkflowCommand, { type: 'run' }>;
      expect(run.scope.nodeId).toBe('n-gen');
      expect(run.scope.nodeIds).toEqual(['n-gen', 'n-gen2']);
    }
  });

  it('addNode.nodeId 是新 id，不做解析', () => {
    const commands: WorkflowCommand[] = [
      { type: 'addNode', nodeType: 'prompt', nodeId: '新卡', position: { x: 0, y: 0 } },
    ];
    const result = resolveAgentNodeIds(commands, graph);
    expect(result).toEqual({ ok: true, commands });
  });

  it('查无此名 → 中文报错', () => {
    const result = resolveAgentNodeIds(
      [{ type: 'removeNode', nodeId: '不存在的卡' }],
      graph,
    );
    expect(result).toEqual({ ok: false, message: '画布上找不到节点「不存在的卡」' });
  });

  it('同名多张卡 → 报错并列出候选节点 id', () => {
    const dup: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('a1', 'prompt', '文案'), node('a2', 'prompt', '文案')],
      edges: [],
    };
    const result = resolveAgentNodeIds([{ type: 'removeNode', nodeId: '文案' }], dup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('多个名为「文案」');
      expect(result.message).toContain('a1');
      expect(result.message).toContain('a2');
    }
  });

  it('空标题节点不参与标题匹配', () => {
    const result = resolveAgentNodeIds([{ type: 'removeNode', nodeId: '' }], graph);
    expect(result.ok).toBe(false);
  });
});
