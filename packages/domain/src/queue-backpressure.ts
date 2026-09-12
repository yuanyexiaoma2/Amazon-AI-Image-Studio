/**
 * Queue concurrency / backpressure helpers (W8-03).
 * Pure domain — no BullMQ imports.
 *
 * Spec §32.9: 30 Fake Generation Items, 4 Worker concurrency → 100% terminal in 2 min;
 * Worker restart must not double-settle.
 */

export const DEFAULT_WORKER_CONCURRENCY = 4;
export const DEFAULT_QUEUE_MAX_WAITING = 200;
export const STRESS_BATCH_SIZE = 30;

export type BackpressureDecision =
  | { admit: true; waiting: number; concurrency: number; maxWaiting: number }
  | {
      admit: false;
      reason: 'QUEUE_BACKPRESSURE';
      waiting: number;
      concurrency: number;
      maxWaiting: number;
    };

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export function resolveWorkerConcurrency(
  env: { WORKER_CONCURRENCY?: string | undefined; [key: string]: string | undefined } = {},
): number {
  return parsePositiveInt(env.WORKER_CONCURRENCY, DEFAULT_WORKER_CONCURRENCY);
}

export function resolveQueueMaxWaiting(
  env: { QUEUE_MAX_WAITING?: string | undefined; [key: string]: string | undefined } = {},
): number {
  return parsePositiveInt(env.QUEUE_MAX_WAITING, DEFAULT_QUEUE_MAX_WAITING);
}

/**
 * Admit a new job only when waiting depth is below the configured ceiling.
 * Active jobs (in-flight ≤ concurrency) do not count against waiting.
 */
export function decideQueueAdmission(input: {
  waiting: number;
  concurrency: number;
  maxWaiting: number;
}): BackpressureDecision {
  const waiting = Math.max(0, Math.floor(input.waiting));
  const concurrency = Math.max(1, Math.floor(input.concurrency));
  const maxWaiting = Math.max(1, Math.floor(input.maxWaiting));
  if (waiting >= maxWaiting) {
    return {
      admit: false,
      reason: 'QUEUE_BACKPRESSURE',
      waiting,
      concurrency,
      maxWaiting,
    };
  }
  return { admit: true, waiting, concurrency, maxWaiting };
}

/**
 * Estimate wall-clock for N Fake items under concurrency (no external model latency).
 * Used by stress reports — not a hard SLA gate in Fake Phase 1.
 */
export function estimateFakeBatchSeconds(input: {
  itemCount: number;
  concurrency: number;
  perItemSeconds: number;
}): number {
  const items = Math.max(0, input.itemCount);
  const conc = Math.max(1, input.concurrency);
  const per = Math.max(0, input.perItemSeconds);
  const waves = Math.ceil(items / conc) || 0;
  return waves * per;
}

/** Stable BullMQ-style job id must be unique per attempt — proves no double publish. */
export function assertUniqueJobIds(jobIds: ReadonlyArray<string>): {
  ok: boolean;
  duplicates: string[];
} {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const id of jobIds) {
    if (seen.has(id)) duplicates.push(id);
    else seen.add(id);
  }
  return { ok: duplicates.length === 0, duplicates };
}
