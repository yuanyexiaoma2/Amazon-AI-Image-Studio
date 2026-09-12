import { describe, expect, it } from 'vitest';
import {
  AMAZON_MAIN_US_V1,
  builtinAmazonMainUsV1Merged,
  loadBuiltinRulePack,
  mergeMarketRulePacks,
  validateMarketRulePack,
  type MarketRulePack,
} from '../src/index.js';

describe('W6-01 Market Rule Pack', () => {
  it('validates amazon-main-us-v1', () => {
    const v = validateMarketRulePack(AMAZON_MAIN_US_V1);
    expect(v.ok).toBe(true);
    expect(AMAZON_MAIN_US_V1.key).toBe('amazon-main-us-v1');
    expect(AMAZON_MAIN_US_V1.version).toBe(2);
    expect(AMAZON_MAIN_US_V1.marketplaceCode).toBe('US');
    const ids = AMAZON_MAIN_US_V1.rules.map((r) => r.ruleId);
    expect(ids).toContain('FILE.DECODABLE');
    expect(ids).toContain('MAIN.BACKGROUND_WHITE');
    expect(ids).toContain('PRODUCT.IDENTITY');
    expect(AMAZON_MAIN_US_V1.rules.find((r) => r.ruleId === 'FILE.DECODABLE')?.nonWaivable).toBe(true);
  });

  it('merges a single pack and hashes snapshot', () => {
    const merged = builtinAmazonMainUsV1Merged();
    expect(merged.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(merged.pack.rules.length).toBe(AMAZON_MAIN_US_V1.rules.length);
    expect(loadBuiltinRulePack().key).toBe('amazon-main-us-v1');
  });

  it('later pack replaces same ruleId', () => {
    const overlay: MarketRulePack = {
      ...AMAZON_MAIN_US_V1,
      key: 'kitchen-us-v1',
      version: 1,
      scope: { type: 'CATEGORY_PREFIX', value: 'Kitchen', specificity: 10 },
      priority: 10,
      rules: [
        {
          ruleId: 'FILE.MIN_SHORT_SIDE',
          evaluator: 'image.minShortSide.v1',
          type: 'DETERMINISTIC',
          severity: 'HIGH',
          nonWaivable: false,
          params: { failBelow: 800, reviewBelow: 1600, unit: 'px' },
        },
      ],
    };
    const merged = mergeMarketRulePacks({
      packs: [AMAZON_MAIN_US_V1, overlay],
      marketplaceCode: 'US',
      category: 'Kitchen > Drinkware',
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const rule = merged.pack.rules.find((r) => r.ruleId === 'FILE.MIN_SHORT_SIDE');
    expect(rule?.params.failBelow).toBe(800);
  });

  it('rejects lowering severity without CR', () => {
    const overlay: MarketRulePack = {
      ...AMAZON_MAIN_US_V1,
      key: 'soft-us-v1',
      scope: { type: 'CATEGORY_PREFIX', value: 'Kitchen', specificity: 5 },
      priority: 1,
      rules: [
        {
          ruleId: 'FILE.DECODABLE',
          evaluator: 'file.decodable.v1',
          type: 'DETERMINISTIC',
          severity: 'LOW',
          nonWaivable: false,
          params: { allowedMime: ['image/png'] },
        },
      ],
    };
    const merged = mergeMarketRulePacks({
      packs: [AMAZON_MAIN_US_V1, overlay],
      marketplaceCode: 'US',
      category: 'Kitchen',
    });
    expect(merged.ok).toBe(false);
  });

  it('allows lowering severity with changeRequestId', () => {
    const overlay: MarketRulePack = {
      ...AMAZON_MAIN_US_V1,
      key: 'soft-us-v1',
      changeRequestId: 'CR-TEST-1',
      scope: { type: 'CATEGORY_PREFIX', value: 'Kitchen', specificity: 5 },
      priority: 1,
      rules: [
        {
          ruleId: 'FILE.DECODABLE',
          evaluator: 'file.decodable.v1',
          type: 'DETERMINISTIC',
          severity: 'LOW',
          nonWaivable: false,
          params: { allowedMime: ['image/png'] },
        },
      ],
    };
    const merged = mergeMarketRulePacks({
      packs: [AMAZON_MAIN_US_V1, overlay],
      marketplaceCode: 'US',
      category: 'Kitchen',
    });
    expect(merged.ok).toBe(true);
  });
});
