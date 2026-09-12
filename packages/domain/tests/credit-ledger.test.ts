import { describe, expect, it } from 'vitest';
import {
  applyCreditEvent,
  emptyBalances,
  foldCreditEvents,
} from '../src/credit-ledger.js';

describe('append-only credit ledger', () => {
  it('grant → reserve → settle', () => {
    let b = emptyBalances();
    b = applyCreditEvent(b, { type: 'GRANT', microunits: 1_000_000 });
    b = applyCreditEvent(b, { type: 'RESERVE', microunits: 100_000 });
    expect(b.availableMicrounits).toBe(900_000);
    expect(b.heldMicrounits).toBe(100_000);
    b = applyCreditEvent(b, { type: 'SETTLE', microunits: 80_000 });
    expect(b.heldMicrounits).toBe(20_000);
    expect(b.consumedMicrounits).toBe(80_000);
    b = applyCreditEvent(b, { type: 'RELEASE', microunits: 20_000 });
    expect(b.heldMicrounits).toBe(0);
    expect(b.availableMicrounits).toBe(920_000);
  });

  it('reserve fails when insufficient', () => {
    expect(() =>
      applyCreditEvent(emptyBalances(), { type: 'RESERVE', microunits: 1 }),
    ).toThrow(/INSUFFICIENT/);
  });

  it('fold reconstructs balances', () => {
    const b = foldCreditEvents([
      { type: 'GRANT', microunits: 500 },
      { type: 'RESERVE', microunits: 200 },
      { type: 'REFUND', microunits: 200 },
    ]);
    expect(b.availableMicrounits).toBe(500);
    expect(b.heldMicrounits).toBe(0);
  });
});
