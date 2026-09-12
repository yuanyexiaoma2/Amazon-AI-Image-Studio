import { describe, expect, it } from 'vitest';
import { FakeImageProvider, FakeVisionProvider } from '../src/fake.js';

describe('FakeImageProvider', () => {
  it('returns a success image for a valid prompt', async () => {
    const p = new FakeImageProvider();
    const result = await p.generate({
      prompt: 'white background product mug',
      width: 2000,
      height: 2000,
    });
    expect(result.provider).toBe('fake');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mimeType).toBe('image/png');
    expect(result.images[0]?.bytes.length).toBeGreaterThan(0);
  });

  it('rejects empty prompt', async () => {
    const p = new FakeImageProvider();
    await expect(p.generate({ prompt: '', width: 1, height: 1 })).rejects.toThrow(/prompt/);
  });
});

describe('FakeVisionProvider', () => {
  it('extracts structured facts with evidence refs', async () => {
    const v = new FakeVisionProvider();
    const result = await v.extractFacts({
      sku: 'MUG-BLK-450',
      category: 'Kitchen > Drinkware',
      marketplace: 'US',
      assetVersionIds: ['00000000-0000-7000-8000-0000000000aa'],
      hints: ['brand:Acme'],
    });
    expect(result.provider).toBe('fake-vision');
    expect(result.facts.some((f) => f.key === 'brand' && f.value === 'Acme')).toBe(true);
    expect(result.facts[0]?.evidenceAssetVersionIds).toHaveLength(1);
    expect(result.locks.length).toBeGreaterThan(0);
  });

  it('rejects empty assetVersionIds', async () => {
    const v = new FakeVisionProvider();
    await expect(v.extractFacts({ assetVersionIds: [] })).rejects.toThrow(/assetVersionIds/);
  });
});

describe('FakeShotPlanProvider', () => {
  it('drafts default 7 briefs without PACKAGE', async () => {
    const { FakeShotPlanProvider } = await import('../src/fake.js');
    const p = new FakeShotPlanProvider();
    const result = await p.draftPlan({
      sku: 'MUG-BLK-450',
      confirmedFacts: [{ key: 'brand', value: 'Acme' }],
    });
    expect(result.provider).toBe('fake-shot-plan');
    expect(result.briefs).toHaveLength(7);
    expect(result.briefs.some((b) => b.slot === 'PACKAGE')).toBe(false);
    expect(result.briefs[0]?.slot).toBe('MAIN');
  });

  it('can manually include PACKAGE', async () => {
    const { FakeShotPlanProvider } = await import('../src/fake.js');
    const p = new FakeShotPlanProvider();
    const result = await p.draftPlan({ includePackage: true });
    expect(result.briefs).toHaveLength(8);
    expect(result.briefs.at(-1)?.slot).toBe('PACKAGE');
  });
});
