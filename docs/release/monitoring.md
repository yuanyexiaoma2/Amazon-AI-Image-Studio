# Monitoring + alert ownership (W9)

**Date:** 2026-09-12 (Asia/Shanghai, UTC+8)  
**Environment covered today:** local / Fake Phase 1 candidate only.  
**Production:** **NO-GO** until `docs/release/go-no-go.md` is a signed GO and this file has **named** receivers (spec §19.9 / §32.15).

> Placeholders below are **intentional**. Owner / ops fill them. Do not invent on-call names or claim alerts are staffed.

## Ownership (owner to fill)

| Channel / signal | Receiver (name + contact) | Backup | Escalation | Filled? |
|---|---|---|---|---|
| App / web down | _____________ | _____________ | _____________ | NO |
| Worker / BullMQ stalled | _____________ | _____________ | _____________ | NO |
| Postgres unavailable | _____________ | _____________ | _____________ | NO |
| Redis unavailable | _____________ | _____________ | _____________ | NO |
| Object storage (MinIO / S3) | _____________ | _____________ | _____________ | NO |
| Queue depth / `QUEUE_BACKPRESSURE` | _____________ | _____________ | _____________ | NO |
| Credit / ledger anomaly | _____________ | _____________ | _____________ | NO |
| Webhook verify failures | _____________ | _____________ | _____________ | NO |
| Auth / 429 / 5xx rate | _____________ | _____________ | _____________ | NO |
| Disk / backup job failed | _____________ | _____________ | _____________ | NO |
| Real Provider spend (Phase 2) | _____________ | _____________ | _____________ | N/A until W0-02 |

**Rollback owner (Production):** _____________  
**Publish authorizer:** _____________

Until these are filled, treat “监控和告警有人接收” as **not met**.

## What exists today (Fake / local)

| Signal | Where | Notes |
|---|---|---|
| Process logs | pino (`@studio/config`) | Redact paths for secrets / JWT / passwords (`docs/security/w8-04-checklist.md`) |
| Web health | Next.js process + `APP_URL` | No hosted APM in-repo |
| Worker health | `pnpm worker` / BullMQ | Stuck-job playbook: `docs/runbooks/provider-outage-stuck-jobs.md` |
| Admin job list | `GET .../admin/jobs` | OWNER/ADMIN; not an alert subscription |
| Outbox relay | `outbox_messages` PENDING | Recovery redispatch is manual / worker |
| Credit snapshot vs ledger | Admin reconciliation | `docs/runbooks/credit-reconciliation.md` |
| CI | GitHub Actions | PR-to-`main` + push `main` / `feat/**` / `feature/**` / `fix/**` |

There is **no** PagerDuty / email / Slack alert subscription in this repo. Do not claim otherwise.

## Suggested alert set (fill owners before Production GO)

Not implemented as hosted monitors. Checklist for ops when Phase 2 starts:

1. Web 5xx &gt; threshold for 5 minutes.  
2. Worker heartbeat missing / `generation-attempt` wait &gt; SLA.  
3. Outbox `PENDING` older than N minutes.  
4. Postgres / Redis / object-storage probe fail.  
5. `QUEUE_BACKPRESSURE` reject spike.  
6. Webhook HMAC failure spike (possible key mismatch — do not log the secret).  
7. Credit RESERVE without matching SETTLE/REFUND past timeout.  
8. Backup job failed or dump older than policy.  
9. **Phase 2 only:** real Provider spend approaching the signed budget cap.

## On-call hygiene

- Never put Provider keys, `AUTH_SECRET`, or webhook secrets in tickets, chat, or this file.  
- `IMAGE_PROVIDER=fake` until W0-02.  
- Incident playbooks: `docs/runbooks/` (variant-batch, provider-outage, credit-reconciliation, backup-restore, user-delete).

## Sign-off (owner to fill)

| Role | Name | Monitors staffed for target env? | Date |
|---|---|---|---|
| Ops / on-call lead | _____________ | YES / NO | _____________ |
