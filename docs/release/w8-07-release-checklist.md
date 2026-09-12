# W8-07 — Release checklist (candidate)

Fake Phase 1 candidate — **not** Production go-live authorization (see W9-02 / §32.15).

| Gate | Status | Evidence |
|---|---|---|
| CI green on release branch | | Actions run URL |
| `pnpm lint && typecheck && test && build` | | Local / CI |
| `pnpm test:eval` Fake baseline | | `docs/eval/w8-phase1-baseline-report.md` |
| `pnpm test:stress-30` | | `docs/eval/w8-03-load-report.md` |
| Security checklist | | `docs/security/w8-04-checklist.md` |
| Backup/restore runbook reviewed | | `docs/runbooks/backup-restore-rollback.md` |
| Staging UAT signed | | `docs/release/w8-07-staging-uat-checklist.md` |
| §18.4 quality thresholds | **EXCEPTION** | Written: Fake-only; real SKU/Provider hung (ADR-0003) |
| No real Provider keys in repo / `.env.example` | | ADR-0001/0003 |
| Rollback plan ≤30 min | | Runbook |
| CHANGELOG / progress ledger DONE | | `docs/progress.md` |

**Release candidate tag (suggested):** `rc-w8-phase1` (do not promote to Production without W9 auth).
