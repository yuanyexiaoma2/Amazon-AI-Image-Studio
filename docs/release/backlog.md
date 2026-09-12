# W9 release backlog — explicit, not hidden flags

**Date:** 2026-09-12 (Asia/Shanghai, UTC+8)  
**Rule:** unresolved work is listed here. Do not ship a silent switch that pretends a hung item is done (spec §19.9).

Severity: `P0` = blocks real Production / data safety; `P1` = blocks Phase 2 or honest Staging UAT; `P2` = non-blocking leftover.

---

## 1. Hung external dependencies (P0 for real Production)

Owner裁决 (ADR-0003 / MSG-016): keys + real SKUs wait until **after** development. These stay `BLOCKED_EXTERNAL`. They are **not** W9 implementation debt.

| ID | Item | Sev | Status | Notes |
|---|---|---|---|---|
| W0-02 | Provider capability / authorized keys | P0 | BLOCKED_EXTERNAL | Secret store only; never commit real keys. ADR-0001 + ADR-0003. |
| W2-07 | ≥10 rights-cleared real SKUs | P0 | BLOCKED_EXTERNAL | Fixtures have **3 synthetic** SKUs only. |
| W4-07 | Staging real generate/edit smoke | P0 | BLOCKED_EXTERNAL | Fake matrix is the Phase 1 substitute. |
| Phase 2 | Real Provider + real-SKU eval / §18.4 | P0 | HUNG | New CRs after keys + materials; do not rewrite Phase 1 history. |
| §19.5 | Real-Provider success case per node | P0 | 挂起 | W5 accepted Fake success+failure matrix (W4-06). |
| W9-02 | Production publish + smoke | P0 | BLOCKED_EXTERNAL | `docs/release/go-no-go.md` = **NO-GO**. Smoke **not run**. |

**Recovery:** owner supplies keys via approved secret path + budget, and ≥10 SKUs in `fixtures/eval-products/` (or documented successor). Then open Phase 2 CRs.

---

## 2. Provider vs docs inconsistencies (allowed §19.9; notes only)

No adapter rewrite this week. These are known Fake/spec gaps — not closed by hiding them.

| ID | Inconsistency | Sev | Disposition |
|---|---|---|---|
| PD-01 | Spec §9 / §19.5 assume a **real** Image Provider success path. Runtime is `FakeImageProviderAdapter` + scenario stamps (tiny PNG / MASK), not vendor pixels. | P1 | Phase 2. Ports (`packages/providers`) stay replaceable. |
| PD-02 | Fake Vision / OCR / Vision-QA / Shot Plan are scenario-driven. They do not fetch `referencedAssetVersionIds` or call external APIs. Docs that say “extract / identity / OCR” mean **Fake mechanics**. | P1 | Already labeled Fake in progress + ADR-0003. |
| PD-03 | Model Registry lists Fake models only. Production model IDs must not be invented (ADR-0001). Capability tables append when W0-02 lifts. | P1 | Wait for keys. |
| PD-04 | Webhook HMAC + poll + late-result paths are proven on **Fake** events. Real vendor signature schemes / payload shapes are unverified. | P1 | W4-07 / Phase 2. |
| PD-05 | `docs/architecture.md` previously ended at W6; W7/W8/W9 living notes added in this buffer. README still says “W0–W2” (non-blocking copy drift). | P2 | Arch updated; README copy is leftover. |
| PD-06 | Spec mentions Playwright browser E2E. Repo E2E is API-level `scripts/e2e-api.mjs` (documented on W6-08). | P2 | Do not claim Playwright is in-repo. |

---

## 3. Visual consistency backlog (allowed §19.9)

Phase 1 is a **Fake mechanics baseline**, not a product-photo quality claim.

| ID | Item | Sev | Status |
|---|---|---|---|
| VC-01 | Eval set is 3 synthetic SKUs × MAIN/FEATURE/LIFESTYLE × 2 = 18 planned Fake candidates — not §32.10 (20×3×2 + dual reviewers). | P1 | Phase 2 after W2-07. |
| VC-02 | §18.4 human first-pass ≥60% / retry ≥80% **not measured** on real Reviewer samples. Written Fake exception. | P0 (Prod) | EXCEPTION on go-no-go. |
| VC-03 | Prompt / QA pack v2 tuned against **Fake** failure types (extent 0.82, overlay failConfidence 0.92, blur review 85). Real-Provider A/B not done. | P1 | `docs/eval/w8-02-prompt-qa-tuning.md` |
| VC-04 | Golden QA 10/10 is scenario match (Fake OCR/Vision), not visual identity vs real photography. | P1 | Do not treat as §18.4 pass. |
| VC-05 | Brand kit / locked palette / font suite (spec §2.3 optional) not started. | P2 | Default-off; would be a new CR, not W9 scope. |

---

## 4. Perf / browser / security leftovers (allowed §19.9)

From W8 审稿 **non-blocking** notes + W8-04/06/07 docs. None is a documented W8 **P0** that a tiny code fix would close this week.

| ID | Item | Sev | Status |
|---|---|---|---|
| PERF-01 | `pnpm test:eval` / `pnpm test:stress-30` are **not wired in CI**. Reports committed; related domain/unit coverage runs in `pnpm test`. | P2 | W8 审稿 non-block. Optional later CI job. |
| PERF-02 | 30-item Fake load is in-process / scripted (wall ~162 ms @ 20 ms Fake). Not a real Provider / multi-worker Staging soak. | P1 | Phase 2 load. |
| PERF-03 | Full 7-image × N-SKU concurrent Staging soak not run. | P2 | After real keys. |
| BR-01 | Browser matrix: Chromium primary; Firefox / Safari “OK expected”, not independently measured this week. No IE11. Studio &lt;1280 is an alert, not a mobile product. | P2 | `docs/eval/w8-06-a11y-browser-notes.md` |
| BR-02 | Playwright not in repo (see PD-06). | P2 | API e2e only. |
| SEC-01 | Authz / signed-URL automation is **contract-level**; cross-tenant still relies on existing integration/e2e. | P2 | W8 审稿 non-block. |
| SEC-02 | Staging secret-store checks on W8-04 checklist are **unchecked** (AUTH_SECRET length, webhook secret, log spot-check). | P1 | Owner / ops. |
| SEC-03 | Penetration test, WAF, Production KMS — out of W8 milestone. | P1 (Prod) | Release hardening with ops. |
| SEC-04 | Account-disable exists; **full purge worker** (30-day object purge) is Staging follow-up. | P1 | `docs/runbooks/user-delete-drill.md` |
| OPS-01 | Backup/restore drill table unsigned; script is a stub. | P1 | `scripts/backup-restore-drill.sh` |
| OPS-02 | W1-09 forgot-password reset still TODO (unscheduled). | P2 | Not W9 scope. |

---

## 5. UAT P0 / P1 tracker (allowed §19.9)

Source: `docs/release/w8-07-staging-uat-checklist.md` (12 Fake scenarios, **unsigned**).

| ID | UAT scenario | Sev if fail | Status 2026-09-12 |
|---|---|---|---|
| UAT-01 | Register / login / sessionVersion logout | P0 | OPEN — not signed |
| UAT-02 | Upload → inspect → Truth approve (3 synthetic SKUs) | P0 | OPEN — covered by CI e2e; human UAT blank |
| UAT-03 | Shot Plan generate → approve → materialize | P0 | OPEN |
| UAT-04 | Studio Fake run + SSE task drawer | P0 | OPEN |
| UAT-05 | QA findings + Review approve/reject | P0 | OPEN |
| UAT-06 | Export bundle + signed download | P0 | OPEN |
| UAT-07 | Variant 3×7 Fake batch + filtered export | P0 | OPEN |
| UAT-08 | Admin jobs / credit adjust (OWNER) | P1 | OPEN |
| UAT-09 | Cross-tenant 403 | P0 | OPEN — automated e2e exists; human UAT blank |
| UAT-10 | Webhook bad signature rejected | P0 | OPEN — automated tests exist; human UAT blank |
| UAT-11 | Worker restart mid Fake batch — no double charge | P0 | OPEN — unique jobId + billing tests; human UAT blank |
| UAT-12 | A11y smoke (Review empty, Studio narrow, keyboard Undo) | P1 | OPEN |

**Open W8/W9 P0 bugs from implementation review:** none documented. W8 审稿 APPROVED with non-blockers only (PERF-01, SEC-01).  
**Do not** invent P0s to justify product-module work. If UAT later finds a P0/P1, file it here and fix under §19.9 — still no new modules.

---

## 6. Conditional second Provider (allowed §19.9 only if core issues converged)

Spec §2.3 / §19.9: a **second** image-provider adapter is optional W8–W9 work, and only when week 1–7 acceptance has converged **and** leftover capacity exists. At most one §2.3 optional.

| Check | Result |
|---|---|
| Core hung deps converged? | **No** — W0-02 / W2-07 / W4-07 still BLOCKED_EXTERNAL |
| First real Provider live? | **No** — Fake only |
| Leftover capacity after buffer docs? | N/A — second adapter would be new product scope |
| **Decision** | **Do not start** a second Provider, auto-failover, translation trial, brand kit, share links, or payments. Recorded so the skip is explicit. |

When W0-02 lifts, the **first** real adapter is the Phase 2 CR — not a second vendor.

---

## 7. Forbidden this week (not started)

3D · full Listing · translation center · team collaboration · UI redesign · swap Postgres / xyflow / BullMQ.

---

## 8. How to close a row

1. Evidence in the matching doc or test.  
2. Status → DONE (implementer) / VERIFIED (审稿).  
3. Do not delete the row; strike via status so the audit trail stays.
