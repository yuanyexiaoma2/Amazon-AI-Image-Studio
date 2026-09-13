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
