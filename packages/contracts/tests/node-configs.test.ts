import { describe, expect, it } from 'vitest';
import {
  PALETTE_NODE_CONFIG_TYPES,
  NODE_CONFIG_SCHEMAS,
  defaultNodeConfig,
  validateNodeConfig,
  validateGraphNodeConfigs,
} from '../src/node-configs.js';

describe('W3-05 node config schemas', () => {
  it('covers the 3 content-card palette node types', () => {
    expect(PALETTE_NODE_CONFIG_TYPES).toEqual(['source_image', 'prompt', 'generate']);
  });

  it('generate config carries inline prompt (无文本卡连线时的兜底)', () => {
    const cfg = defaultNodeConfig('generate') as { prompt?: string };
    expect(cfg.prompt).toBe('');
    const parsed = validateNodeConfig('generate', { prompt: '一只猫坐在窗台上' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect((parsed.config as { prompt?: string }).prompt).toBe('一只猫坐在窗台上');
  });

  it('includes system approval_selector schema', () => {
    expect(NODE_CONFIG_SCHEMAS.approval_selector).toBeDefined();
    expect(defaultNodeConfig('approval_selector').requiredRole).toBe('REVIEWER');
  });

  it('parses defaults for every registered type', () => {
    for (const type of Object.keys(NODE_CONFIG_SCHEMAS) as Array<keyof typeof NODE_CONFIG_SCHEMAS>) {
      const cfg = defaultNodeConfig(type);
      expect(cfg.schemaVersion).toBe(1);
      const again = validateNodeConfig(type, {});
      expect(again.ok).toBe(true);
    }
  });

  it('rejects invalid generate count', () => {
    const bad = validateNodeConfig('generate', { count: 99 });
    expect(bad.ok).toBe(false);
  });

  it('validates graph node configs and normalizes', () => {
    const result = validateGraphNodeConfigs([
      { id: 'n1', type: 'source_image', config: {} },
      { id: 'n2', type: 'generate', config: { modelKey: 'primary-image-edit' } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.normalized?.[1]?.config.count).toBe(2);
  });

  it('accepts maskId on replace_background / inpaint (W5-B)', () => {
    const rb = validateNodeConfig('replace_background', {
      fidelity: 0.9,
      lightBlend: 0.3,
      maskId: '11111111-1111-7111-8111-111111111111',
    });
    expect(rb.ok).toBe(true);
    const ip = validateNodeConfig('inpaint', {
      strength: 0.5,
      maskId: '11111111-1111-7111-8111-111111111111',
    });
    expect(ip.ok).toBe(true);
  });

  it('defaults outpaint / upscale configs (W5-C)', () => {
    const op = defaultNodeConfig('outpaint');
    expect(op.targetRatio).toBe('1:1');
    expect(op.placement).toBe('center');
    expect(op.modelKey).toBe('auto');
    const up = validateNodeConfig('upscale', {
      engineKey: 'default-upscale',
      targetResolution: '2K',
    });
    expect(up.ok).toBe(true);
    if (up.ok) {
      expect(up.config.targetResolution).toBe('2K');
      expect(up.config.engineKey).toBe('default-upscale');
    }
  });
});
