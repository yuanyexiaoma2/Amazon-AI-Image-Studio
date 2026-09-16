import { describe, expect, it } from 'vitest';
import {
  buildAssetOptions,
  buildBriefOptions,
  buildMaskOptions,
  buildModelOptions,
  buildTruthOptions,
  withCurrentOption,
} from '../components/studio/config-options';

describe('config option builders (V2 PR-2 dropdowns)', () => {
  it('buildAssetOptions keeps only assets with a current version and not archived', () => {
    const options = buildAssetOptions([
      { id: 'a1', status: 'READY', originalFilename: 'main.png', currentVersionId: 'v1234567890' },
      { id: 'a2', status: 'ARCHIVED', originalFilename: 'old.png', currentVersionId: 'v-archived' },
      { id: 'a3', status: 'PROCESSING', originalFilename: null, currentVersionId: null },
    ]);
    expect(options).toEqual([
      { value: 'v1234567890', label: 'main.png（v: v1234567…）' },
    ]);
  });

  it('buildTruthOptions maps the current revision or stays empty', () => {
    expect(buildTruthOptions(null)).toEqual([]);
    expect(buildTruthOptions({ id: 'rev-1', revision: 3, status: 'APPROVED' })).toEqual([
      { value: 'rev-1', label: '修订 #3 · 已批准' },
    ]);
  });

  it('buildBriefOptions sorts by orderIndex and summarizes slot/purpose', () => {
    const options = buildBriefOptions([
      { id: 'b2', slot: 'detail', purpose: '细节特写', orderIndex: 2 },
      { id: 'b1', slot: 'hero', purpose: '主图', orderIndex: 1 },
    ]);
    expect(options.map((o) => o.value)).toEqual(['b1', 'b2']);
    expect(options[0].label).toBe('#1 主图 · 主图');
  });

  it('buildMaskOptions labels masks without a name field', () => {
    const options = buildMaskOptions([{ id: 'mask-abcdef-1', updatedAt: '2026-09-15T01:02:03Z' }]);
    expect(options).toEqual([
      { value: 'mask-abcdef-1', label: '蒙版 mask-abc…（2026-09-15）' },
    ]);
  });

  it('buildModelOptions filters by operation when provided', () => {
    const models = [
      { key: 'gen', displayName: 'Generator', operations: ['GENERATE', 'INPAINT'] },
      { key: 'up', displayName: 'Upscaler', operations: ['UPSCALE'] },
    ];
    expect(buildModelOptions(models).map((o) => o.value)).toEqual(['gen', 'up']);
    expect(buildModelOptions(models, 'UPSCALE').map((o) => o.value)).toEqual(['up']);
    expect(buildModelOptions(models, 'INPAINT')[0]).toEqual({
      value: 'gen',
      label: 'gen · Generator',
    });
  });

  it('withCurrentOption prepends the stored value when missing from the list', () => {
    const list = [{ value: 'x', label: 'X' }];
    expect(withCurrentOption(list, '')).toEqual(list);
    expect(withCurrentOption(list, 'x')).toEqual(list);
    const merged = withCurrentOption(list, 'stale-value-1');
    expect(merged[0]).toEqual({ value: 'stale-value-1', label: '当前值：stale-va…' });
    expect(merged[1]).toEqual(list[0]);
  });
});
