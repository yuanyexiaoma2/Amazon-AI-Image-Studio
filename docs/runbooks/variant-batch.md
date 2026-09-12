# Runbook — Variant batch (W7)

## Goal

Run a Fake 3-color × 7-slot variant batch, recover from single-item failure, and export only passing items.

## Preconditions

- Fake Provider only (ADR-0003). No real keys.
- Postgres / Redis / MinIO up (`docker compose -f infra/docker-compose.yml up -d postgres redis minio`).
- `INSPECT_INLINE=1` (and optionally `VARIANT_QA_INLINE=1`) for in-process QA.
- Workspace has an OWNER/ADMIN/MEMBER user, project, and enough credits (admin ADJUST or seed GRANT).

## Steps

1. Create master variant (`BASE`) with default locks (structure/logo/text/composition/attachment_count).
2. Create three child color variants with `masterVariantId` + `variant_components` color hex.
3. Attach / materialize master workflow (`POST .../variants/{id}/materialize` for children after master `workflowId` is set).
4. `POST .../projects/{projectId}/variant-runs` with `variantIds` (3 children), `budgetLimit`, `confirmBudget` if needed, `idempotencyKey`.
5. Poll `GET .../variant-runs/{runId}` — expect 21 items; status `SUCCEEDED` or `PARTIAL`.
6. Single-item fail: pass `itemScenarios: { "RED:MAIN": "AUTH" }` — RED MAIN fails; other items succeed; run status `PARTIAL`.
7. Retry: `POST .../variant-items/{itemId}/retry` with `scenario: "SUCCESS"`.
8. Variant QA lock: set `visionScenario: "STRUCTURE_CHANGE"` or `"LOGO_CHANGE"` → item `QA_BLOCK` / report BLOCK.
9. Export: approve QA_PASS items, then `POST .../variant-runs/{runId}/export` — failed items filtered; manifest lists `filteredOut`.

## Ledger

Each item RESERVE → SETTLE (success) or REFUND (fail). Reconcile via `/admin?workspaceId=...` or `GET .../admin/reconciliation`.
