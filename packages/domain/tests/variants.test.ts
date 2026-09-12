import { describe, expect, it } from 'vitest';
import {
  aggregateVariantRunStatus,
  applyVariantOverridesToGraph,
  assertVariantBatchBudget,
  filterExportableVariantItems,
  validateMasterLink,
  validateVariantCode,
  variantLockQaExpectation,
  emptyWorkflowGraph,
} from '../src/index.js';

describe('variants domain', () => {
  it('normalizes and validates codes', () => {
    expect(validateVariantCode('red').ok).toBe(true);
    expect(validateVariantCode('').ok).toBe(false);
  });

  it('rejects nested masters', () => {
    const r = validateMasterLink({
      masterVariantId: 'm1',
      masterIsRoot: false,
      sameProject: true,
    });
    expect(r.ok).toBe(false);
  });

  it('injects color overrides into generate nodes', () => {
    const graph = emptyWorkflowGraph();
    graph.nodes.push({
      id: 'g1',
      type: 'generate',
      position: { x: 0, y: 0 },
      config: { prompt: 'product' },
    });
    const next = applyVariantOverridesToGraph(graph, {
      variantCode: 'RED',
      components: [{ componentKey: 'body', colorHex: '#FF0000', colorDescription: 'red' }],
    });
    const prompt = String(next.nodes[0]?.config?.prompt ?? '');
    expect(prompt).toContain('VARIANT_CODE=RED');
    expect(prompt).toContain('#FF0000');
  });

  it('budget gate requires confirmBudget', () => {
    const blocked = assertVariantBatchBudget({
      variantCount: 3,
      budgetLimit: { currency: 'USD', amount: 0.000001 },
      confirmBudget: false,
    });
    expect(blocked.ok).toBe(false);
    const ok = assertVariantBatchBudget({
      variantCount: 3,
      budgetLimit: { currency: 'USD', amount: 0.000001 },
      confirmBudget: true,
    });
    expect(ok.ok).toBe(true);
  });

  it('aggregates partial batch status', () => {
    expect(
      aggregateVariantRunStatus(['QA_PASS', 'FAILED_FINAL', 'QA_PASS']),
    ).toBe('PARTIAL');
    expect(aggregateVariantRunStatus(['QA_PASS', 'QA_PASS'])).toBe('SUCCEEDED');
  });

  it('structure/logo scenarios map to BLOCK', () => {
    expect(variantLockQaExpectation('STRUCTURE_CHANGE').overall).toBe('BLOCK');
    expect(variantLockQaExpectation('LOGO_CHANGE').overall).toBe('BLOCK');
    expect(variantLockQaExpectation('COMPOSITION_DRIFT').overall).toBe('REVIEW');
    expect(variantLockQaExpectation('SUCCESS').overall).toBe('PASS');
  });

  it('filters exportable items', () => {
    const kept = filterExportableVariantItems([
      { status: 'QA_PASS' as const },
      { status: 'QA_BLOCK' as const },
      { status: 'FAILED_FINAL' as const },
      { status: 'QA_REVIEW' as const },
    ]);
    expect(kept).toHaveLength(1);
    expect(
      filterExportableVariantItems(
        [{ status: 'QA_REVIEW' as const }],
        { allowReview: true },
      ),
    ).toHaveLength(1);
  });
});
