import { describe, expect, it } from 'vitest';
import {
  resolveModelRegistry,
  listEnabledModels,
  KIE_GENERATE_MODEL,
  FAKE_PRIMARY_MODEL,
} from '../src/model-registry.js';

describe('resolveModelRegistry P2-A', () => {
  it('returns Fake models by default', () => {
    const regs = resolveModelRegistry('fake');
    expect(listEnabledModels(regs).some((m) => m.modelId === FAKE_PRIMARY_MODEL.modelId)).toBe(true);
  });

  it('enables documented kie Market model IDs when provider=kie', () => {
    const regs = resolveModelRegistry('kie');
    const enabled = listEnabledModels(regs);
    expect(enabled.some((m) => m.modelId === KIE_GENERATE_MODEL.modelId)).toBe(true);
    expect(enabled.every((m) => m.provider === 'kie')).toBe(true);
  });
});

describe('resolveAutoModelKey（智能匹配）', () => {
  it('kie 注册表：无参考图 → 文生图偏好（Nano Banana Pro）', async () => {
    const { resolveAutoModelKey } = await import('../src/model-registry.js');
    const regs = resolveModelRegistry('kie');
    expect(resolveAutoModelKey(false, regs)).toBe('kie-nano-banana-pro');
  });

  it('kie 注册表：有参考图/编辑操作 → 编辑偏好（Nano Banana Pro）', async () => {
    const { resolveAutoModelKey } = await import('../src/model-registry.js');
    const regs = resolveModelRegistry('kie');
    expect(resolveAutoModelKey(true, regs)).toBe('kie-nano-banana-pro');
  });

  it('fake 注册表回退到演示模型', async () => {
    const { resolveAutoModelKey } = await import('../src/model-registry.js');
    const regs = resolveModelRegistry('fake');
    expect(resolveAutoModelKey(false, regs)).toBe('primary-image-generate');
    expect(resolveAutoModelKey(true, regs)).toBe('primary-image-edit');
  });
});
