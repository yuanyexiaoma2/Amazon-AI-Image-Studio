import { describe, expect, it } from 'vitest';
import {
  shouldAutoRetry,
  attemptStatusForError,
  aggregateRunStatus,
  canCancelRun,
  budgetExceeded,
  amountToMicrounits,
} from '../src/generation-run.js';

describe('retry policy §9.3', () => {
  it('AUTH/VALIDATION/POLICY/QUOTA never auto-retry', () => {
    for (const c of ['AUTH', 'VALIDATION', 'POLICY', 'QUOTA'] as const) {
      expect(shouldAutoRetry(c, 0)).toBe(false);
      expect(attemptStatusForError(c, 0)).toBe('FAILED_FINAL');
    }
  });

  it('RATE_LIMIT/TRANSIENT retry with cap', () => {
    expect(shouldAutoRetry('RATE_LIMIT', 0)).toBe(true);
    expect(shouldAutoRetry('TRANSIENT', 4)).toBe(true);
    expect(shouldAutoRetry('TRANSIENT', 5)).toBe(false);
  });

  it('TIMEOUT max 2, UNKNOWN once', () => {
    expect(shouldAutoRetry('TIMEOUT', 0)).toBe(true);
    expect(shouldAutoRetry('TIMEOUT', 1)).toBe(true);
    expect(shouldAutoRetry('TIMEOUT', 2)).toBe(false);
    expect(shouldAutoRetry('UNKNOWN', 0)).toBe(true);
    expect(shouldAutoRetry('UNKNOWN', 1)).toBe(false);
  });
});

describe('run aggregate + cancel', () => {
  it('all succeeded → SUCCEEDED', () => {
    expect(aggregateRunStatus(['SUCCEEDED', 'SUCCEEDED'], false)).toBe('SUCCEEDED');
  });
  it('any running → RUNNING', () => {
    expect(aggregateRunStatus(['SUCCEEDED', 'RUNNING'], false)).toBe('RUNNING');
  });
  it('can cancel queued/running only', () => {
    expect(canCancelRun('QUEUED')).toBe(true);
    expect(canCancelRun('SUCCEEDED')).toBe(false);
  });
});

describe('budget gate', () => {
  it('flags overrun', () => {
    expect(
      budgetExceeded(
        { currency: 'USD', estimatedMicrounits: amountToMicrounits(3), unitCount: 3 },
        { currency: 'USD', amount: 2.5 },
      ),
    ).toBe(true);
    expect(
      budgetExceeded(
        { currency: 'USD', estimatedMicrounits: amountToMicrounits(1), unitCount: 1 },
        { currency: 'USD', amount: 2.5 },
      ),
    ).toBe(false);
  });
});
