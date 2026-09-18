/**
 * 「套装」一句话派生：1 张文本卡（产品描述）+ 3 张生图卡（白底/场景/细节），
 * 生图卡连文本卡的 prompt 端口，各自 config.prompt 作后缀（运行时拼接）。
 * 纯模板，不调用 LLM。一个命令批次 = 一次撤销单位。
 */
import type { WorkflowCommand } from '@studio/contracts';

export type SuiteShot = { key: string; title: string; suffix: string; ratio: string };

export const SUITE_SHOTS: ReadonlyArray<SuiteShot> = [
  { key: 'hero', title: '主图 · 白底', suffix: '白底产品主图，简洁干净，电商主图风格', ratio: '1:1' },
  { key: 'scene', title: '场景图', suffix: '生活场景图，产品与场景自然融合，简洁高级', ratio: '4:3' },
  { key: 'detail', title: '细节特写', suffix: '细节特写，突出材质与工艺质感', ratio: '3:4' },
];

export function buildSuiteCommands(
  description: string,
  origin: { x: number; y: number },
  seed: number | string = Date.now(),
): { commands: WorkflowCommand[]; selectId: string } {
  const p = `suite-${seed}`;
  const textId = `${p}-text`;
  const genId = (key: string) => `${p}-${key}`;
  // 2×2 网格：文本卡左上，三张生图卡占其余三格。
  const slots = [
    { x: origin.x, y: origin.y },
    { x: origin.x + 300, y: origin.y },
    { x: origin.x, y: origin.y + 380 },
    { x: origin.x + 300, y: origin.y + 380 },
  ];
  const commands: WorkflowCommand[] = [
    {
      type: 'addNode',
      nodeType: 'prompt',
      nodeId: textId,
      position: slots[0]!,
      config: { schemaVersion: 1, text: description, title: '产品描述' },
    },
    ...SUITE_SHOTS.map(
      (shot, i): WorkflowCommand => ({
        type: 'addNode',
        nodeType: 'generate',
        nodeId: genId(shot.key),
        position: slots[i + 1]!,
        config: { schemaVersion: 1, prompt: shot.suffix, ratio: shot.ratio, title: shot.title },
      }),
    ),
    ...SUITE_SHOTS.map(
      (shot, i): WorkflowCommand => ({
        type: 'connect',
        edgeId: `${p}-e${i}`,
        source: textId,
        sourceHandle: 'prompt',
        target: genId(shot.key),
        targetHandle: 'prompt',
      }),
    ),
  ];
  return { commands, selectId: genId('hero') };
}
