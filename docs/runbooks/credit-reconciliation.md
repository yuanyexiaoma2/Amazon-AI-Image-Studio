# Runbook — Credit reconciliation (W7-06)

## Source of truth

Append-only `credit_ledger_events`. `credit_accounts` holds a **controlled snapshot** updated only inside the ledger write transaction.

## Check

1. Open `/admin?workspaceId=<id>` (OWNER/ADMIN) or `GET /api/workspaces/{id}/admin/reconciliation`.
2. Compare `snapshot` vs `folded` (fold of all ledger events).
3. `drift: true` means investigate — never silently edit the snapshot outside `CreditRepository.appendEvent`.

## Adjust

- `POST /api/workspaces/{id}/admin/credits` with positive `microunits`, required `note`, `idempotencyKey`.
- Event type `ADJUST`; audited as `credits.adjust`.
- MEMBER/REVIEWER → 403.

## Variant batch

Per variant item: `reserve:variant-item:{id}` / `settle:` / `refund:`. Partial batch failure must leave successes settled and failures refunded.
