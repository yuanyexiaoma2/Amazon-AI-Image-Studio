import { describe, expect, it } from 'vitest';
import { validateNodeConfig } from '@studio/contracts';
import {
  applyConfigEdit,
  coerceConfigValue,
} from '../components/studio/config-options';

describe('coerceConfigValue / applyConfigEdit (PR-6-08)', () => {
  it('清空 prompt text → 空字符串（不是 null），配置仍然合法', () => {
    expect(coerceConfigValue('text', '')).toEqual({ action: 'set', value: '' });
    const next = applyConfigEdit({ schemaVersion: 1, text: '旧提示词' }, 'text', '');
    const validated = validateNodeConfig('prompt', next);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.config.text).toBe('');
  });

  it('清空 slot（可空字段）→ null', () => {
    expect(coerceConfigValue('slot', '')).toEqual({ action: 'set', value: null });
    const validated = validateNodeConfig(
      'prompt',
      applyConfigEdit({ schemaVersion: 1, slot: 'hero' }, 'slot', ''),
    );
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.config.slot).toBeNull();
  });

  it('清空 seed（可空 + 数字）→ null 优先于删 key', () => {
    expect(coerceConfigValue('seed', '')).toEqual({ action: 'set', value: null });
  });

  it('清空 count → 删掉 key，Zod 默认回填 2', () => {
    expect(coerceConfigValue('count', '')).toEqual({ action: 'delete' });
    const validated = validateNodeConfig(
      'generate',
      applyConfigEdit({ schemaVersion: 1, count: 5 }, 'count', ''),
    );
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.config.count).toBe(2);
  });

  it('数字字段输垃圾 → 删掉 key，回默认值', () => {
    expect(coerceConfigValue('fidelity', 'abc')).toEqual({ action: 'delete' });
    const validated = validateNodeConfig(
      'replace_background',
      applyConfigEdit({ schemaVersion: 1, fidelity: 0.9 }, 'fidelity', 'abc'),
    );
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.config.fidelity).toBe(0.85);
  });

  it('正常输入：数字字段转 Number，字符串字段原样', () => {
    expect(coerceConfigValue('count', '4')).toEqual({ action: 'set', value: 4 });
    expect(coerceConfigValue('text', '纯白背景')).toEqual({
      action: 'set',
      value: '纯白背景',
    });
  });

  it('applyConfigEdit 不改动原对象', () => {
    const prev = { schemaVersion: 1, count: 3 };
    applyConfigEdit(prev, 'count', '');
    expect(prev.count).toBe(3);
  });
});
