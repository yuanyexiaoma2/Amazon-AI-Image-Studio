/**
 * V2 PR-6 — empty-canvas starter templates.
 *
 * Pure builders: each template returns ONE WorkflowCommand batch (addNode ×N
 * with configs baked in, then connect ×M) so the whole template lands as a
 * single undoable server-side batch. Port ids / required inputs follow the
 * domain NODE_REGISTRY (packages/domain/src/workflow-graph.ts); configs are
 * partial Zod shells — the server fills remaining defaults.
 */
import type { WorkflowCommand } from '@studio/contracts';

export type StarterTemplateId = 'hero' | 'background' | 'trio' | 'blank';

export type StarterTemplate = {
  id: StarterTemplateId;
  title: string;
  description: string;
};

export const STARTER_TEMPLATES: ReadonlyArray<StarterTemplate> = [
  {
    id: 'hero',
    title: '主图直出',
    description: '参考图 + 提示词 + 产品图 → 生成合规主图',
  },
  {
    id: 'background',
    title: '抠图换背景',
    description: '抠出产品主体，再用提示词替换背景',
  },
  {
    id: 'trio',
    title: '三类图套装',
    description: '主图 / 卖点图 / 场景图 三条生成线一次搭好',
  },
  {
    id: 'blank',
    title: '空白画布',
    description: '从空画布开始，自由搭建流程',
  },
];

const HERO_PROMPT_TEXT =
  '主图：纯白背景，产品居中正视，光线均匀柔和，突出材质与细节；产品外观、颜色与标识保持完全一致，不得添加文字或水印。';

const BACKGROUND_PROMPT_TEXT =
  '背景：替换为简洁明亮的浅色场景，光影自然融合；产品主体、边缘与细节保持原样，不得改变外观。';

const TRIO_PROMPTS: ReadonlyArray<{ slot: string; label: string; text: string }> = [
  {
    slot: 'hero',
    label: '主图',
    text: '主图：纯白背景，产品居中正视，突出整体外观与质感，符合亚马逊主图规范；不得添加文字。',
  },
  {
    slot: 'selling-point',
    label: '卖点图',
    text: '卖点图：突出核心卖点与功能细节，构图聚焦局部特写，画面干净，信息清晰。',
  },
  {
    slot: 'lifestyle',
    label: '场景图',
    text: '场景图：真实使用场景，自然光线，生活方式氛围；产品为视觉主体，外观保持一致。',
  },
];

type NodeSpec = {
  key: string;
  nodeType: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
};

type EdgeSpec = {
  /** [node key, output port id] */
  from: [string, string];
  /** [node key, input port id] */
  to: [string, string];
};

function buildBatch(
  idPrefix: string,
  nodes: NodeSpec[],
  edges: EdgeSpec[],
): WorkflowCommand[] {
  const nodeId = (key: string) => `${idPrefix}-${key}`;
  const commands: WorkflowCommand[] = nodes.map((n) => ({
    type: 'addNode',
    nodeType: n.nodeType,
    nodeId: nodeId(n.key),
    position: { x: n.x, y: n.y },
    config: { schemaVersion: 1, ...(n.config ?? {}) },
  }));
  for (const [i, e] of edges.entries()) {
    commands.push({
      type: 'connect',
      edgeId: `${idPrefix}-e${i}`,
      source: nodeId(e.from[0]),
      sourceHandle: e.from[1],
      target: nodeId(e.to[0]),
      targetHandle: e.to[1],
    });
  }
  return commands;
}

/**
 * Build the command batch for a starter template. `blank` yields an empty
 * batch (the overlay is simply dismissed). `seed` makes node/edge ids unique
 * across repeated applications (defaults to a timestamp).
 */
export function buildStarterTemplateCommands(
  id: StarterTemplateId,
  seed: number | string = Date.now(),
): WorkflowCommand[] {
  const p = `tpl-${id}-${seed}`;
  switch (id) {
    case 'hero':
      return buildBatch(
        p,
        [
          { key: 'source', nodeType: 'source_image', x: 0, y: 0 },
          { key: 'truth', nodeType: 'product_truth', x: 0, y: 180 },
          {
            key: 'prompt',
            nodeType: 'prompt',
            x: 280,
            y: 40,
            config: { text: HERO_PROMPT_TEXT, slot: 'hero' },
          },
          { key: 'generate', nodeType: 'generate', x: 560, y: 60 },
        ],
        [
          { from: ['prompt', 'prompt'], to: ['generate', 'prompt'] },
          { from: ['truth', 'truth'], to: ['generate', 'truth'] },
          { from: ['source', 'image'], to: ['generate', 'references'] },
        ],
      );
    case 'background':
      return buildBatch(
        p,
        [
          { key: 'source', nodeType: 'source_image', x: 0, y: 60 },
          { key: 'removebg', nodeType: 'remove_background', x: 280, y: 0 },
          {
            key: 'prompt',
            nodeType: 'prompt',
            x: 280,
            y: 200,
            config: { text: BACKGROUND_PROMPT_TEXT },
          },
          { key: 'replacebg', nodeType: 'replace_background', x: 560, y: 60 },
        ],
        [
          { from: ['source', 'image'], to: ['removebg', 'image'] },
          { from: ['removebg', 'image'], to: ['replacebg', 'image'] },
          { from: ['removebg', 'mask'], to: ['replacebg', 'mask'] },
          { from: ['prompt', 'prompt'], to: ['replacebg', 'prompt'] },
        ],
      );
    case 'trio': {
      const nodes: NodeSpec[] = [
        { key: 'source', nodeType: 'source_image', x: 0, y: 160 },
        { key: 'truth', nodeType: 'product_truth', x: 0, y: 340 },
        ...TRIO_PROMPTS.map(
          (t, i): NodeSpec => ({
            key: `prompt${i}`,
            nodeType: 'prompt',
            x: 280,
            y: i * 160,
            config: { text: t.text, slot: t.slot },
          }),
        ),
        ...TRIO_PROMPTS.map(
          (_, i): NodeSpec => ({
            key: `generate${i}`,
            nodeType: 'generate',
            x: 560,
            y: i * 160,
          }),
        ),
      ];
      const edges: EdgeSpec[] = TRIO_PROMPTS.flatMap((_, i): EdgeSpec[] => [
        { from: [`prompt${i}`, 'prompt'], to: [`generate${i}`, 'prompt'] },
        { from: ['truth', 'truth'], to: [`generate${i}`, 'truth'] },
        { from: ['source', 'image'], to: [`generate${i}`, 'references'] },
      ]);
      return buildBatch(p, nodes, edges);
    }
    case 'blank':
      return [];
  }
}
