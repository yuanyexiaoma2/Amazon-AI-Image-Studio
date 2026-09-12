# W8-03 load report — 30 Fake generation items

- **Generated:** 2026-09-12T14:21:55.112Z (UTC)
- **Provider:** Fake only (ADR-0003)
- **WORKER_CONCURRENCY:** 4
- **QUEUE_MAX_WAITING:** 200
- **Batch size:** 30

## Results

| Metric | Value |
|---|---:|
| Admitted | 30 |
| Backpressure rejected | 0 |
| Terminal SUCCEEDED | 30 |
| Wall clock (ms) | 162.0 |
| Estimate (s) @ 20ms/item | 0.16 |
| Spec SLA (s) | 120 |
| Under SLA | YES |
| Unique jobIds | YES |
| Duplicate jobIds | 0 |

## BullMQ / outbox behavior proven (scripted)

1. **Stable jobId** `gen-attempt-{attemptId}` — all unique.
2. **Admit-time backpressure** via `decideQueueAdmission` (waiting ≥ maxWaiting → `QUEUE_BACKPRESSURE`); publish path in `apps/web/lib/queues.ts` bumps outbox attempt and leaves row PENDING for relay.
3. **Worker concurrency** = 4 (apps/worker `Worker({ concurrency })`).
4. **No double-settle simulation:** unique jobIds ⇒ BullMQ duplicate add is treated as already published (existing outbox relay).

## Reproduce

```bash
pnpm --filter @studio/domain build
pnpm test:stress-30
# optional: WORKER_CONCURRENCY=4 QUEUE_MAX_WAITING=200 pnpm test:stress-30
```
