# W8-02 — Prompt / reference / QA threshold tuning (Fake Phase 1)

**Date:** 2026-09-12 (Asia/Shanghai)  
**Provider:** Fake only (ADR-0003)  
**Rule pack:** `amazon-main-us-v1` **v1 → v2**

## Main Fake failure types (inputs)

| Fake scenario | Observed gate | Root cause (Fake) |
|---|---|---|
| `STRUCTURE_CHANGE` | BLOCK via `PRODUCT.IDENTITY` | Geometry FAIL vs master locks |
| `LOGO_CHANGE` | BLOCK via `PRODUCT.IDENTITY` | Logo FAIL |
| `COMPOSITION_DRIFT` | REVIEW | Framing drift without hard FAIL |
| `OVERLAY_TEXT` | BLOCK | High-conf off-print OCR |
| `LOW_CONFIDENCE` | REVIEW | Overlay OCR below failConfidence |
| `ATTACHMENT_COUNT` | REVIEW | itemCount / soldItems REVIEW |
| `WATERMARK` | BLOCK/REVIEW | Pixel border or vision watermark |
| `FACT_MISMATCH` | BLOCK | Confirmed brand vs OCR conflict |

## Changes shipped

### Prompts / refs (code)

- `packages/domain/src/prompt-templates.ts` — injects structure / logo / composition locks + “first source_image is identity reference”.
- `materializeShotPlanToGraph` uses hardened prompt + negative text.
- `DEFAULT_SEVEN_IMAGE_TEMPLATE` MAIN `must` / `mustNot` extended with the same locks.

### QA thresholds (pack v2)

| Param | v1 | v2 | Rationale |
|---|---:|---:|---|
| `MAIN.SUBJECT_FRAME_EXTENT.requiredExtent` | 0.85 | **0.82** | Reduce false REVIEW on synthetic soft crops |
| `MAIN.NO_OVERLAY_TEXT.failConfidence` | 0.90 | **0.92** | Require higher OCR conf before FAIL (LOW_CONFIDENCE → REVIEW) |
| `QUALITY.BLUR.reviewBelow` | 90 | **85** | Fewer soft REVIEW on Fake solid PNGs |

Docs: `docs/qa-rules/amazon-main-us-v1.md` + JSON artifact synced.

## Out of scope

Real Provider prompt A/B, real SKU first-pass ≥60%/≥80% (§18.4) — Phase 2 / W2-07.
