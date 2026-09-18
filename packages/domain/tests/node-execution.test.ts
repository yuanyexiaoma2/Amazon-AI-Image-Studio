import { describe, expect, it } from 'vitest';
import {
  computeOutpaintCanvas,
  computeUpscaleTargetDims,
  extractOutpaintParams,
  extractPromptFromInputs,
  extractUpscaleParams,
  operationForNodeType,
  parseAspectRatio,
  type ResolvedPortInput,
} from '../src/node-execution.js';
import type { GraphNode } from '../src/workflow-graph.js';

describe('W5-C node-execution outpaint/upscale', () => {
  it('maps outpaint → OUTPAINT and upscale → UPSCALE', () => {
    expect(operationForNodeType('outpaint')).toBe('OUTPAINT');
    expect(operationForNodeType('upscale')).toBe('UPSCALE');
  });

  it('parseAspectRatio accepts W:H', () => {
    expect(parseAspectRatio('16:9')).toEqual({ w: 16, h: 9 });
    expect(parseAspectRatio('4:5')).toEqual({ w: 4, h: 5 });
    expect(parseAspectRatio('bad')).toEqual({ w: 1, h: 1 });
  });

  it('computeOutpaintCanvas expands width for wider target ratio', () => {
    const c = computeOutpaintCanvas({
      sourceWidth: 1000,
      sourceHeight: 1000,
      targetRatio: '16:9',
      placement: 'center',
    });
    expect(c.canvasHeight).toBe(1000);
    expect(c.canvasWidth).toBe(Math.round(1000 * (16 / 9)));
    expect(c.offsetX).toBe(Math.floor((c.canvasWidth - 1000) / 2));
    expect(c.offsetY).toBe(0);
  });

  it('computeOutpaintCanvas expands height for taller target ratio', () => {
    const c = computeOutpaintCanvas({
      sourceWidth: 1000,
      sourceHeight: 1000,
      targetRatio: '4:5',
      placement: 'top',
    });
    expect(c.canvasWidth).toBe(1000);
    expect(c.canvasHeight).toBe(Math.round(1000 / (4 / 5)));
    expect(c.offsetY).toBe(0);
    expect(c.placement).toBe('top');
  });

  it('placement left/right/bottom anchors original', () => {
    const left = computeOutpaintCanvas({
      sourceWidth: 800,
      sourceHeight: 600,
      targetRatio: '16:9',
      placement: 'left',
    });
    expect(left.offsetX).toBe(0);
    const right = computeOutpaintCanvas({
      sourceWidth: 800,
      sourceHeight: 600,
      targetRatio: '16:9',
      placement: 'right',
    });
    expect(right.offsetX).toBe(right.canvasWidth - 800);
    const bottom = computeOutpaintCanvas({
      sourceWidth: 600,
      sourceHeight: 800,
      targetRatio: '1:1',
      placement: 'bottom',
    });
    expect(bottom.offsetY).toBe(bottom.canvasHeight - 800);
  });

  it('extractOutpaintParams / extractUpscaleParams read config defaults', () => {
    expect(
      extractOutpaintParams({
        id: 'n',
        type: 'outpaint',
        position: { x: 0, y: 0 },
        config: {},
      }),
    ).toEqual({ targetRatio: '1:1', placement: 'center', modelKey: undefined });
    expect(
      extractUpscaleParams({
        id: 'n',
        type: 'upscale',
        position: { x: 0, y: 0 },
        config: { engineKey: 'default-upscale', targetResolution: '2K' },
      }),
    ).toEqual({ engineKey: 'default-upscale', targetResolution: '2K' });
  });

  it('computeUpscaleTargetDims scales long edge to tier', () => {
    const t4k = computeUpscaleTargetDims({
      sourceWidth: 1024,
      sourceHeight: 512,
      targetResolution: '4K',
    });
    expect(t4k.width).toBe(4096);
    expect(t4k.height).toBe(2048);
    expect(t4k.tierPixels).toBe(4096);
    const t2k = computeUpscaleTargetDims({
      sourceWidth: 800,
      sourceHeight: 1200,
      targetResolution: '2K',
    });
    expect(t2k.height).toBe(2048);
    expect(t2k.width).toBe(Math.round(800 * (2048 / 1200)));
  });

  it('computeUpscaleTargetDims never downscales', () => {
    const t = computeUpscaleTargetDims({
      sourceWidth: 5000,
      sourceHeight: 4000,
      targetResolution: '4K',
    });
    expect(t.width).toBe(5000);
    expect(t.height).toBe(4000);
    expect(t.scale).toBe(1);
  });
});

describe('extractPromptFromInputs（连线文本 + config.prompt 后缀）', () => {
  const gen = (config: Record<string, unknown>): GraphNode => ({
    id: 'g',
    type: 'generate',
    position: { x: 0, y: 0 },
    config,
  });
  const promptInput = (text: string): ResolvedPortInput => ({
    portId: 'prompt',
    sourceNodeId: 'p',
    sourceType: 'prompt',
    sourceConfig: { text },
    order: 0,
  });

  it('无连线 → config.prompt 单独生效', () => {
    expect(extractPromptFromInputs(gen({ prompt: '白底主图' }), []).prompt).toBe('白底主图');
  });

  it('有连线且无后缀 → 连线文本', () => {
    expect(extractPromptFromInputs(gen({}), [promptInput('一只猫')]).prompt).toBe('一只猫');
  });

  it('有连线且有 config.prompt → 拼接为「连线文本，后缀」', () => {
    expect(
      extractPromptFromInputs(gen({ prompt: '白底主图，简洁干净' }), [promptInput('一只猫')]).prompt,
    ).toBe('一只猫，白底主图，简洁干净');
  });

  it('空白后缀不拼接；空 config.prompt 且无连线 → 兜底占位', () => {
    expect(extractPromptFromInputs(gen({ prompt: '  ' }), [promptInput('一只猫')]).prompt).toBe('一只猫');
    expect(extractPromptFromInputs(gen({ prompt: '' }), []).prompt).toContain('Execute');
  });
});
