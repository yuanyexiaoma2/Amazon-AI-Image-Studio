# W8-01 Phase 1 Fake visual eval — baseline report

- **Generated:** 2026-09-12T14:21:54.849Z (UTC) / Asia/Shanghai = UTC+8
- **Provider:** Fake only (ADR-0003)
- **Rule pack:** `amazon-main-us-v1` @ 2
- **SKUs:** 3 synthetic (W2-07 10 real SKUs still BLOCKED_EXTERNAL)

## Scope adaptation

Spec W8-01 asks to expand to 10 SKUs. Phase 1 uses the **3 synthetic SKUs** already in `fixtures/eval-products/` because real photography is hung (owner裁决). This report is a **Fake mechanics baseline**, not a §18.4 production quality claim.

## SKU brief matrix (MAIN / FEATURE / LIFESTYLE × 2 candidates)

| SKU | Name | Slots | Candidates |
|---|---|---|---:|
| SKU-SYN-001 | Synthetic Insulated Mug | MAIN, FEATURE, LIFESTYLE | 6 |
| SKU-SYN-002 | Synthetic Water Bottle | MAIN, FEATURE, LIFESTYLE | 6 |
| SKU-SYN-003 | Synthetic Earbud Case | MAIN, FEATURE, LIFESTYLE | 6 |

- **Total Fake candidates (planned):** 18 (= 3 × 3 × 2)
- Spec §32.10 full protocol (20×3×2=120 + dual reviewers) = **Phase 2** after real SKUs / keys.

## Golden QA scenario results (Fake OCR/Vision)

| ID | Scenario | Expected | Actual | Match | Non-PASS rules |
|---|---|---|---|---|---|
| attachment-count | ATTACHMENT_COUNT | REVIEW | REVIEW | YES | MAIN.ONLY_SOLD_ITEMS:REVIEW; PRODUCT.IDENTITY:REVIEW |
| composition-drift | COMPOSITION_DRIFT | REVIEW | REVIEW | YES | PRODUCT.IDENTITY:REVIEW |
| fact-mismatch | FACT_MISMATCH | BLOCK | BLOCK | YES | PRODUCT.FACT_TEXT_MATCH:FAIL |
| identity-mismatch | IDENTITY_MISMATCH | BLOCK | BLOCK | YES | PRODUCT.IDENTITY:FAIL |
| logo-change | LOGO_CHANGE | BLOCK | BLOCK | YES | PRODUCT.IDENTITY:FAIL |
| low-confidence | LOW_CONFIDENCE | REVIEW | REVIEW | YES | MAIN.NO_OVERLAY_TEXT:REVIEW |
| overlay-text | OVERLAY_TEXT | BLOCK | BLOCK | YES | MAIN.NO_OVERLAY_TEXT:FAIL |
| pass | SUCCESS | PASS | PASS | YES | — |
| structure-change | STRUCTURE_CHANGE | BLOCK | BLOCK | YES | PRODUCT.IDENTITY:FAIL |
| watermark | WATERMARK | BLOCK | BLOCK | YES | MAIN.NO_BORDER_OR_WATERMARK:FAIL |

- **Matched:** 10 / 10
- **Mismatched:** 0 / 10

## Failure-type histogram (golden non-PASS)

| Rule | Count |
|---|---:|
| PRODUCT.IDENTITY | 5 |
| MAIN.NO_OVERLAY_TEXT | 2 |
| MAIN.ONLY_SOLD_ITEMS | 1 |
| PRODUCT.FACT_TEXT_MATCH | 1 |
| MAIN.NO_BORDER_OR_WATERMARK | 1 |

## §18.4 / first-pass approve rate

Not measured on real Reviewer samples in Phase 1. Written exception: **Fake-only baseline**; human ≥60% / ≥80% thresholds deferred to Phase 2 (ADR-0003).

## How to reproduce

```bash
pnpm --filter @studio/domain build && pnpm --filter @studio/providers build
pnpm test:eval
```
