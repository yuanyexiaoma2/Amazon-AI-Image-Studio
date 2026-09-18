import { describe, expect, it } from 'vitest';
import {
  resolveModelRegistry,
  listEnabledModels,
  resolveAutoModelKey,
  validateModelRunInput,
  KIE_NANO_BANANA_2_MODEL,
  KIE_NANO_BANANA_2_LITE_MODEL,
  KIE_GPT_IMAGE_2_5_FLARE_GENERATE,
  KIE_GPT_IMAGE_2_5_FLARE_EDIT,
  KIE_GPT_IMAGE_2_GENERATE_MODEL,
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
    expect(enabled.some((m) => m.modelId === KIE_NANO_BANANA_2_MODEL.modelId)).toBe(true);
    expect(enabled.every((m) => m.provider === 'kie')).toBe(true);
    // Seedream 已下架（所有者要求）
    expect(enabled.some((m) => m.modelId.includes('seedream'))).toBe(false);
  });
});

describe('resolveAutoModelKey（智能匹配）', () => {
  it('kie 注册表：无参考图 → 文生图偏好（Nano Banana 2）', () => {
    const regs = resolveModelRegistry('kie');
    expect(resolveAutoModelKey(false, regs)).toBe('kie-nano-banana-2');
  });

  it('kie 注册表：有参考图/编辑操作 → 编辑偏好（Nano Banana 2）', () => {
    const regs = resolveModelRegistry('kie');
    expect(resolveAutoModelKey(true, regs)).toBe('kie-nano-banana-2');
  });

  it('fake 注册表回退到演示模型', () => {
    const regs = resolveModelRegistry('fake');
    expect(resolveAutoModelKey(false, regs)).toBe('primary-image-generate');
    expect(resolveAutoModelKey(true, regs)).toBe('primary-image-edit');
  });
});

describe('validateModelRunInput（提交前校验）', () => {
  it('双能模型：有/无参考图均通过', () => {
    expect(
      validateModelRunInput(FAKE_PRIMARY_MODEL, {
        hasReferences: false,
        ratio: '1:1',
        resolution: '2K',
      }),
    ).toEqual([]);
    expect(
      validateModelRunInput(FAKE_PRIMARY_MODEL, {
        hasReferences: true,
        ratio: '1:1',
        resolution: '2K',
      }),
    ).toEqual([]);
  });

  it('i2i-only 模型无参考图 → 中文报错', () => {
    const errors = validateModelRunInput(KIE_GPT_IMAGE_2_5_FLARE_EDIT, { hasReferences: false });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('必须连接参考图');
  });

  it('t2i-only 模型带参考图 → 中文报错', () => {
    const errors = validateModelRunInput(KIE_GPT_IMAGE_2_5_FLARE_GENERATE, {
      hasReferences: true,
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('不能连接参考图');
  });

  it('比例不在模型档位内 → 报错并列出可用比例', () => {
    const errors = validateModelRunInput(FAKE_PRIMARY_MODEL, {
      hasReferences: false,
      ratio: '21:9',
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('21:9');
    expect(errors[0]).toContain('可用');
  });

  it('清晰度不在模型档位内 → 报错', () => {
    const errors = validateModelRunInput(KIE_NANO_BANANA_2_LITE_MODEL, {
      hasReferences: false,
      resolution: '4K',
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('4K');
  });

  it('不传 ratio/resolution 时跳过档位校验', () => {
    expect(validateModelRunInput(KIE_GPT_IMAGE_2_GENERATE_MODEL, { hasReferences: false })).toEqual(
      [],
    );
  });
});
