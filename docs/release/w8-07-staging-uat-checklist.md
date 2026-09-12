# W8-07 — Staging UAT checklist (Fake Phase 1)

**Date:** 2026-09-12 · **No Production keys** · ADR-0003 Fake only

| # | Scenario | Pass? | Notes |
|---|---|---|---|
| 1 | Register / login / sessionVersion logout | | |
| 2 | Upload → inspect → Truth Pack approve (3 synthetic SKUs) | | |
| 3 | Shot Plan generate → approve → materialize | | |
| 4 | Studio Fake run + SSE task drawer | | |
| 5 | QA findings + Review approve/reject | | |
| 6 | Export bundle + signed download | | |
| 7 | Variant 3×7 Fake batch + filtered export | | |
| 8 | Admin jobs / credit adjust (OWNER) | | |
| 9 | Cross-tenant 403 | | |
| 10 | Webhook bad signature rejected | | |
| 11 | Worker restart mid Fake batch — no double charge | | |
| 12 | A11y smoke: Review empty state, Studio narrow warning, keyboard Undo | | |

**Sign-off:** _____________ (UAT lead) · Date: _____________
