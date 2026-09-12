import { describe, expect, it } from 'vitest';
import { buildHardenedPromptText, buildHardenedNegative } from '../src/prompt-templates.js';
import { materializeShotPlanToGraph } from '../src/materialize-shot-plan.js';
import type { ShotPlanCanvasPayload } from '../src/shot-plan.js';
import { DEFAULT_SEVEN_IMAGE_TEMPLATE } from '../src/shot-plan.js';

describe('W8-02 prompt / ref hardening', () => {
  it('injects structure/logo/composition locks for MAIN', () => {
    const text = buildHardenedPromptText({
      slot: 'MAIN',
      purpose: 'Amazon search results main image',
      must: ['pure white background'],
      mustNot: ['overlay text'],
    });
    expect(text).toMatch(/structure lock/i);
    expect(text).toMatch(/logo lock/i);
    expect(text).toMatch(/composition lock/i);
    expect(text).toMatch(/identity reference/i);
    expect(buildHardenedNegative(['overlay text'], 'MAIN')).toMatch(/geometry/i);
  });

  it('materialize embeds hardened prompt text', () => {
    const briefs = Array.from({ length: 7 }, (_, i) => ({
      briefId: `00000000-0000-7000-8000-00000000000${i + 1}`,
      slot: (['MAIN', 'FEATURE', 'FEATURE', 'DETAIL', 'DIMENSION', 'LIFESTYLE', 'LIFESTYLE'] as const)[i]!,
      purpose: `Brief ${i + 1}`,
      orderIndex: i + 1,
      aspectRatio: '1:1',
      targetPixels: { width: 2000, height: 2000 },
      copy: [] as string[],
      must: ['keep geometry'],
      mustNot: ['overlay text'],
      qaPolicy: 'amazon-main-us-v1',
      referencedAssetVersionIds: [] as string[],
    }));
    const payload: ShotPlanCanvasPayload = {
      planDocumentId: '22222222-2222-7222-8222-222222222222',
      planRevisionId: '33333333-3333-7333-8333-333333333333',
      projectId: '44444444-4444-7444-8444-444444444444',
      workspaceId: '55555555-5555-7555-8555-555555555555',
      truthRevisionId: '66666666-6666-7666-8666-666666666666',
      briefs,
    };
    const result = materializeShotPlanToGraph(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prompt = result.graph.nodes.find((n) => n.id === 'n-prompt-1');
    expect(String(prompt?.config?.text ?? '')).toMatch(/structure lock/i);
  });

  it('DEFAULT_SEVEN_IMAGE_TEMPLATE MAIN includes W8-02 locks', () => {
    const main = DEFAULT_SEVEN_IMAGE_TEMPLATE.find((e) => e.slot === 'MAIN');
    expect(main?.must.some((m) => /structure lock/i.test(m))).toBe(true);
    expect(main?.must.some((m) => /logo lock/i.test(m))).toBe(true);
  });
});
