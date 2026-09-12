import { describe, expect, it } from 'vitest';
import {
  PALETTE_NODE_CONFIG_TYPES,
  NODE_CONFIG_SCHEMAS,
  defaultNodeConfig,
  validateNodeConfig,
  validateGraphNodeConfigs,
} from '../src/node-configs.js';

describe('W3-05 node config schemas', () => {
  it('covers all 11 palette node types', () => {
    expect(PALETTE_NODE_CONFIG_TYPES).toHaveLength(11);
    expect(PALETTE_NODE_CONFIG_TYPES).toEqual([
      'source_image',
      'product_truth',
      'prompt',
      'remove_background',
      'generate',
      'replace_background',
      'inpaint',
      'outpaint',
      'upscale',
      'qa_gate',
      'export',
    ]);
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
});
