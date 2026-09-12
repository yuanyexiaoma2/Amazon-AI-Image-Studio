import { describe, expect, it } from 'vitest';
import {
  assertUniqueJobIds,
  decideQueueAdmission,
  DEFAULT_WORKER_CONCURRENCY,
  estimateFakeBatchSeconds,
  resolveQueueMaxWaiting,
  resolveWorkerConcurrency,
  STRESS_BATCH_SIZE,
} from '../src/queue-backpressure.js';

describe('W8-03 queue backpressure', () => {
  it('defaults concurrency=4 and maxWaiting=200', () => {
    expect(resolveWorkerConcurrency({})).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(resolveQueueMaxWaiting({})).toBe(200);
    expect(resolveWorkerConcurrency({ WORKER_CONCURRENCY: '8' })).toBe(8);
  });

  it('refuses admit when waiting >= maxWaiting', () => {
    const ok = decideQueueAdmission({ waiting: 10, concurrency: 4, maxWaiting: 200 });
    expect(ok.admit).toBe(true);
    const blocked = decideQueueAdmission({ waiting: 200, concurrency: 4, maxWaiting: 200 });
    expect(blocked.admit).toBe(false);
    if (blocked.admit) return;
    expect(blocked.reason).toBe('QUEUE_BACKPRESSURE');
  });

  it('estimates 30-item Fake batch under concurrency 4', () => {
    expect(STRESS_BATCH_SIZE).toBe(30);
    // 30/4 = 8 waves * 0.05s = 0.4s << 120s SLA
    const secs = estimateFakeBatchSeconds({
      itemCount: STRESS_BATCH_SIZE,
      concurrency: 4,
      perItemSeconds: 0.05,
    });
    expect(secs).toBeLessThan(120);
    expect(secs).toBe(8 * 0.05);
  });

  it('detects duplicate job ids (outbox / BullMQ stability)', () => {
    expect(assertUniqueJobIds(['gen-attempt-a', 'gen-attempt-b']).ok).toBe(true);
    const d = assertUniqueJobIds(['gen-attempt-a', 'gen-attempt-a']);
    expect(d.ok).toBe(false);
    expect(d.duplicates).toEqual(['gen-attempt-a']);
  });
});
