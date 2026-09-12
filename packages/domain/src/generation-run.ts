/**
 * Generation Run / Attempt state machine + retry policy (spec §4.3, §9.3).
 * Pure domain — no Prisma / BullMQ / Next.js.
 */

export type GenerationRunStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'BLOCKED'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  | 'CANCEL_REQUESTED'
  | 'CANCELED';

export type GenerationItemStatus = GenerationRunStatus;

export type GenerationAttemptStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  | 'CANCEL_REQUESTED'
  | 'CANCELED';

export type ProviderErrorClass =
  | 'AUTH'
  | 'VALIDATION'
  | 'POLICY'
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'TIMEOUT'
  | 'QUOTA'
  | 'UNKNOWN';

/** AUTH/VALIDATION/POLICY/QUOTA → no auto-retry; RATE_LIMIT/TRANSIENT → backoff; TIMEOUT max 2; UNKNOWN once. */
export function shouldAutoRetry(
  errorClass: ProviderErrorClass,
  priorAutoRetries: number,
): boolean {
  switch (errorClass) {
    case 'AUTH':
    case 'VALIDATION':
    case 'POLICY':
    case 'QUOTA':
      return false;
    case 'RATE_LIMIT':
    case 'TRANSIENT':
      return priorAutoRetries < 5;
    case 'TIMEOUT':
      return priorAutoRetries < 2;
    case 'UNKNOWN':
      return priorAutoRetries < 1;
    default:
      return false;
  }
}

/** Exponential backoff with full jitter (ms). */
export function retryBackoffMs(attemptIndex: number, baseMs = 1000, maxMs = 60_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attemptIndex));
  return Math.floor(Math.random() * (exp + 1));
}

export function attemptStatusForError(
  errorClass: ProviderErrorClass,
  priorAutoRetries: number,
): Extract<GenerationAttemptStatus, 'FAILED_RETRYABLE' | 'FAILED_FINAL'> {
  return shouldAutoRetry(errorClass, priorAutoRetries) ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
}

const TERMINAL_RUN: ReadonlySet<GenerationRunStatus> = new Set([
  'SUCCEEDED',
  'FAILED_FINAL',
  'CANCELED',
  'BLOCKED',
]);

export function isTerminalRunStatus(status: GenerationRunStatus): boolean {
  return TERMINAL_RUN.has(status);
}

export function canCancelRun(status: GenerationRunStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING' || status === 'VALIDATING';
}

export function canRetryAttempt(status: GenerationAttemptStatus): boolean {
  return status === 'FAILED_RETRYABLE' || status === 'FAILED_FINAL' || status === 'CANCELED';
}

/** Aggregate run status from item statuses after a change. */
export function aggregateRunStatus(
  itemStatuses: ReadonlyArray<GenerationItemStatus>,
  cancelRequested: boolean,
): GenerationRunStatus {
  if (itemStatuses.length === 0) return cancelRequested ? 'CANCELED' : 'QUEUED';
  if (cancelRequested) {
    const allDone = itemStatuses.every(
      (s) => s === 'SUCCEEDED' || s === 'FAILED_FINAL' || s === 'CANCELED' || s === 'FAILED_RETRYABLE',
    );
    if (allDone) {
      return itemStatuses.every((s) => s === 'CANCELED' || s === 'SUCCEEDED')
        ? itemStatuses.every((s) => s === 'CANCELED')
          ? 'CANCELED'
          : 'SUCCEEDED'
        : 'CANCELED';
    }
    return 'CANCEL_REQUESTED';
  }
  if (itemStatuses.every((s) => s === 'SUCCEEDED')) return 'SUCCEEDED';
  if (itemStatuses.some((s) => s === 'RUNNING' || s === 'QUEUED')) {
    if (itemStatuses.some((s) => s === 'RUNNING')) return 'RUNNING';
    return 'QUEUED';
  }
  if (itemStatuses.some((s) => s === 'FAILED_RETRYABLE')) return 'FAILED_RETRYABLE';
  if (itemStatuses.some((s) => s === 'FAILED_FINAL')) return 'FAILED_FINAL';
  if (itemStatuses.every((s) => s === 'CANCELED')) return 'CANCELED';
  return 'RUNNING';
}

export const RUN_WRITE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

export type MoneyEstimate = {
  currency: string;
  /** Micro-units (1e6 = 1.0 major unit). */
  estimatedMicrounits: number;
  unitCount: number;
};

export type BudgetLimit = {
  currency: string;
  /** Major units as decimal string or number from API. */
  amount: number;
};

export function budgetExceeded(estimate: MoneyEstimate, budget: BudgetLimit | null | undefined): boolean {
  if (!budget) return false;
  if (budget.currency !== estimate.currency) return true;
  const budgetMicro = Math.round(budget.amount * 1_000_000);
  return estimate.estimatedMicrounits > budgetMicro;
}

export function amountToMicrounits(amount: number): number {
  return Math.round(amount * 1_000_000);
}

export function microunitsToAmount(micro: number): number {
  return micro / 1_000_000;
}
