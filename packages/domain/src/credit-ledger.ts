/**
 * Append-only credit ledger rules (spec §9.4).
 * Balance is derived from events — never silently mutate a naked balance field.
 */

export type CreditEventType =
  | 'GRANT'
  | 'RESERVE'
  | 'SETTLE'
  | 'REFUND'
  | 'RELEASE'
  | 'ADJUST';

export type CreditLedgerBalances = {
  /** Sum of GRANT + ADJUST - SETTLED consumed (derived). */
  availableMicrounits: number;
  heldMicrounits: number;
  consumedMicrounits: number;
};

export type CreditLedgerEventInput = {
  type: CreditEventType;
  microunits: number;
  idempotencyKey: string;
  attemptId?: string | null;
  runId?: string | null;
  note?: string;
};

/** Apply one event to derived balances (pure). microunits always positive magnitude. */
export function applyCreditEvent(
  balances: CreditLedgerBalances,
  event: Pick<CreditLedgerEventInput, 'type' | 'microunits'>,
): CreditLedgerBalances {
  const n = Math.abs(event.microunits);
  switch (event.type) {
    case 'GRANT':
    case 'ADJUST':
      return { ...balances, availableMicrounits: balances.availableMicrounits + n };
    case 'RESERVE': {
      if (balances.availableMicrounits < n) {
        throw new Error('INSUFFICIENT_CREDITS');
      }
      return {
        ...balances,
        availableMicrounits: balances.availableMicrounits - n,
        heldMicrounits: balances.heldMicrounits + n,
      };
    }
    case 'SETTLE': {
      // Consume from held; if actual > held, pull extra from available.
      const fromHeld = Math.min(n, balances.heldMicrounits);
      const extra = n - fromHeld;
      if (balances.availableMicrounits < extra) {
        throw new Error('INSUFFICIENT_CREDITS_FOR_SETTLE');
      }
      return {
        availableMicrounits: balances.availableMicrounits - extra,
        heldMicrounits: balances.heldMicrounits - fromHeld,
        consumedMicrounits: balances.consumedMicrounits + n,
      };
    }
    case 'REFUND':
    case 'RELEASE': {
      // Return held to available (cancel / failure without COGS).
      const fromHeld = Math.min(n, balances.heldMicrounits);
      return {
        ...balances,
        availableMicrounits: balances.availableMicrounits + fromHeld,
        heldMicrounits: balances.heldMicrounits - fromHeld,
      };
    }
    default:
      throw new Error(`Unknown credit event type`);
  }
}

export function emptyBalances(): CreditLedgerBalances {
  return { availableMicrounits: 0, heldMicrounits: 0, consumedMicrounits: 0 };
}

export function foldCreditEvents(
  events: ReadonlyArray<Pick<CreditLedgerEventInput, 'type' | 'microunits'>>,
): CreditLedgerBalances {
  return events.reduce(
    (acc, e) => applyCreditEvent(acc, e),
    emptyBalances(),
  );
}

export function reserveIdempotencyKey(attemptId: string): string {
  return `reserve:${attemptId}`;
}

export function settleIdempotencyKey(attemptId: string): string {
  return `settle:${attemptId}`;
}

export function refundIdempotencyKey(attemptId: string): string {
  return `refund:${attemptId}`;
}
