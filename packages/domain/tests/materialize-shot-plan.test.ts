import { describe, expect, it } from 'vitest';
import {
  collectReferencedAssetVersionIds,
  materializeShotPlanToGraph,
} from '../src/materialize-shot-plan.js';
import type { ShotPlanCanvasPayload } from '../src/shot-plan.js';
import { validateWorkflowGraph } from '../src/workflow-graph.js';

function payload(overrides?: Partial<ShotPlanCanvasPayload>): ShotPlanCanvasPayload {
  const briefs = Array.from({ length: 7 }, (_, i) => ({
    briefId: `00000000-0000-7000-8000-00000000000${i + 1}`,
    slot: (['MAIN', 'FEATURE', 'FEATURE', 'DETAIL', 'DIMENSION', 'LIFESTYLE', 'LIFESTYLE'] as const)[i]!,
    purpose: `Brief ${i + 1}`,
    orderIndex: i + 1,
    aspectRatio: '1:1',
    targetPixels: { width: 2000, height: 2000 },
    copy: [],
    must: ['keep geometry'],
    mustNot: ['overlay text'],
    qaPolicy: i === 0 ? 'amazon-main-us-v1' : 'amazon-generic-us-v1',
    referencedAssetVersionIds:
      i === 0 ? ['11111111-1111-7111-8111-111111111111'] : ([] as string[]),
  }));
  return {
    planDocumentId: '22222222-2222-7222-8222-222222222222',
    planRevisionId: '33333333-3333-7333-8333-333333333333',
    projectId: '44444444-4444-7444-8444-444444444444',
    workspaceId: '55555555-5555-7555-8555-555555555555',
    truthRevisionId: '66666666-6666-7666-8666-666666666666',
    briefs,
    ...overrides,
  };
}

describe('W3-08 materializeShotPlanToGraph', () => {
  it('builds a valid 7-brief workflow (shared + per-brief prompt/generate)', () => {
    const result = materializeShotPlanToGraph(payload());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.briefCount).toBe(7);
    // 2 shared sources + 7 prompts + 7 generates + qa + approval + export = 19
    expect(result.graph.nodes).toHaveLength(19);
    expect(result.graph.nodes.filter((n) => n.type === 'generate')).toHaveLength(7);
    expect(result.graph.nodes.filter((n) => n.type === 'prompt')).toHaveLength(7);
    expect(result.graph.nodes.some((n) => n.type === 'approval_selector')).toBe(true);
    const v = validateWorkflowGraph(result.graph);
    expect(v.ok).toBe(true);
    const source = result.graph.nodes.find((n) => n.type === 'source_image');
    expect(source?.config?.assetVersionId).toBe('11111111-1111-7111-8111-111111111111');
    const truth = result.graph.nodes.find((n) => n.type === 'product_truth');
    expect(truth?.config?.truthRevisionId).toBe('66666666-6666-7666-8666-666666666666');
  });

  it('collects referencedAssetVersionIds without changing payload shape', () => {
    const p = payload();
    expect(collectReferencedAssetVersionIds(p)).toEqual([
      '11111111-1111-7111-8111-111111111111',
    ]);
  });

  it('rejects empty briefs', () => {
    const result = materializeShotPlanToGraph(payload({ briefs: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EMPTY_BRIEFS');
  });
});
