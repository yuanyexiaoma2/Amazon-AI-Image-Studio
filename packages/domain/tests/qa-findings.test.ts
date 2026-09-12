import { describe, expect, it } from 'vitest';
import { aggregateQaReport, fullFrameRegion, type QaFinding } from '../src/index.js';

function f(partial: Partial<QaFinding> & Pick<QaFinding, 'status' | 'severity'>): QaFinding {
  return {
    ruleId: partial.ruleId ?? 'R',
    ruleVersion: 1,
    evaluator: 'x',
    nonWaivable: partial.nonWaivable ?? false,
    message: 'm',
    evidence: { candidateAssetVersionId: 'av', regions: [fullFrameRegion()] },
    ...partial,
  };
}

describe('W6-05 QA aggregation', () => {
  it('all PASS → PASS', () => {
    expect(aggregateQaReport([f({ status: 'PASS', severity: 'HIGH' })])).toBe('PASS');
  });

  it('REVIEW without FAIL → REVIEW', () => {
    expect(
      aggregateQaReport([
        f({ status: 'PASS', severity: 'HIGH' }),
        f({ status: 'REVIEW', severity: 'MEDIUM' }),
      ]),
    ).toBe('REVIEW');
  });

  it('MEDIUM FAIL → REVIEW', () => {
    expect(aggregateQaReport([f({ status: 'FAIL', severity: 'MEDIUM' })])).toBe('REVIEW');
  });

  it('HIGH FAIL → BLOCK', () => {
    expect(aggregateQaReport([f({ status: 'FAIL', severity: 'HIGH' })])).toBe('BLOCK');
  });

  it('CRITICAL FAIL → BLOCK', () => {
    expect(aggregateQaReport([f({ status: 'FAIL', severity: 'CRITICAL' })])).toBe('BLOCK');
  });

  it('nonWaivable FAIL → BLOCK', () => {
    expect(
      aggregateQaReport([f({ status: 'FAIL', severity: 'LOW', nonWaivable: true })]),
    ).toBe('BLOCK');
  });
});
