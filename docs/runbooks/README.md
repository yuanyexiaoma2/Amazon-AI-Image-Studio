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

## W9 release (docs)

Living pack under `docs/release/`: `go-no-go.md`, `backlog.md`, `monitoring.md`.
Alert receivers are **placeholders** until the owner fills them. Production is **NO-GO**.

## P2-A self-use

- [self-serve-setup.md](./self-serve-setup.md) — clone → env → run → export (kie.ai plug-and-play)

