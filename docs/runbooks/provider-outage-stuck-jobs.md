# Runbook — Provider outage / stuck jobs (W7-07)

## Symptoms

- Generation attempts stuck in `RUNNING` / `QUEUED`.
- Outbox rows `PENDING` or `FAILED`.
- Variant run `RUNNING` longer than expected (Fake batch is synchronous — if hung, check API process).

## Fake / local

1. `GET /api/workspaces/{id}/admin/jobs` — inspect attempts, QA, export, variant runs, outbox.
2. Redis/BullMQ: restart worker (`pnpm worker`).
3. Redispatch: `POST /api/workspaces/{id}/admin/jobs` `{ "outboxId": "..." }` (OWNER/ADMIN, audited).
4. Provider Fake failure matrix (W4-06): AUTH/VALIDATION/POLICY/QUOTA no auto-retry; use item-level retry for variants.

## Do not

- Put real provider keys in repo or `.env.example` (ADR-0003).
- Force-settle credits without a matching ledger event.
