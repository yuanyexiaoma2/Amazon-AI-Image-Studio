# Runbooks

Operational playbooks for Amazon AI Image Studio.

## Templates

Copy `TEMPLATE.md` when adding a new runbook (incident, restore, deploy, etc.).

## Current (W1)

| Runbook | Status |
|---|---|
| Local infrastructure health | See `local-infra-health.md` |

## W7 ops

- [variant-batch.md](./variant-batch.md) — 3×7 Fake batch, partial retry, export filter
- [credit-reconciliation.md](./credit-reconciliation.md) — ledger fold vs snapshot, admin ADJUST
- [provider-outage-stuck-jobs.md](./provider-outage-stuck-jobs.md) — stuck jobs / outbox redispatch

## W8

- `backup-restore-rollback.md` — backup / restore / app rollback drill
- `user-delete-drill.md` — account disable / project soft-delete drill
