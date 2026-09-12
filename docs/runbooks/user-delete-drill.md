# Runbook — User delete / project soft-delete drill (W8-05)

Aligned with spec §32.12 (tombstone + 30-day restore window).

## Project archive vs delete

1. **Archive** → read-only; reversible without purge.
2. **Soft delete** → `DELETE /projects/{id}` (when enabled) starts 30-day restore window.
3. **Restore** → `POST /projects/{id}/restore` within 30 days.
4. **Purge** → after 30 days remove originals/derived/masks/export ZIPs; keep non-identifying tombstone.

## Account disable (existing)

`POST /api/account/disable` (authenticated) marks user inactive; JWT `sessionVersion` invalidates sessions (ADR-0002).

## Drill checklist (Fake / Staging)

| Step | Owner | Pass? | Notes |
|---|---|---|---|
| Disable test user → next API call 401 | | | |
| Soft-delete project (or simulate status) → hidden from default lists | | | |
| Restore within window | | | |
| Confirm Credit ledger rows retained | | | Financial retention — do not hard-delete |
| Confirm Export signed URLs expire; bundle → PURGED after purge | | | |

## Evidence (Phase 1)

Code paths for account disable exist (`apps/web/app/api/account/disable`). Full purge worker is Staging follow-up; this runbook is the drill script for UAT (W8-07).
