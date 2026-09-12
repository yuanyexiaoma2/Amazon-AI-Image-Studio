# amazon-main-us-v1 — Market Rule Pack

- **Key / version:** `amazon-main-us-v1` @ 1
- **Marketplace:** US (Amazon.com). First-ship only; other marketplaces are not activated.
- **Scope:** `CATEGORY_PREFIX` / `GENERIC_NON_APPAREL` / specificity `0`.
- **Effective date:** 2026-09-11
- **JSON artifact:** `docs/qa-rules/amazon-main-us-v1.json` (mirrors runtime `packages/domain/src/qa-rules/amazon-main-us-v1.ts`)

## Source and disclaimer

Thresholds are **this product's machine implementation**, sized to tolerate JPEG / anti-alias error. They are **not** Amazon's verbatim published numbers and do **not** constitute Amazon acceptance, legal advice, or an IP conclusion (spec §11.6 / §31.15).

Public discussion references recorded on the pack:

- https://sellercentral.amazon.com/seller-forums/discussions/t/7366420bc9ccfb8656594e6edcf4ece6
- https://sellercentral.amazon.com/seller-forums/discussions/t/4b3c4c39-6f8c-4312-aa0e-99982eb8f5e1

Category-specific packs, when added, merge by `scope.specificity` then `priority`; same `ruleId` is replaced wholesale. Lowering severity or clearing `nonWaivable` requires an approved Change Request ID.

## Rules (v1)

| ruleId | evaluator | severity | nonWaivable | Notes |
|---|---|---|---|---|
| FILE.DECODABLE | file.decodable.v1 | CRITICAL | yes | PNG/JPEG only |
| FILE.MIN_SHORT_SIDE | image.minShortSide.v1 | HIGH | no | FAIL &lt;1000px; REVIEW 1000–1999; PASS ≥2000 |
| MAIN.BACKGROUND_WHITE | amazon.backgroundWhite.v1 | HIGH | no | Mask complement minus 5px-@2k halo; FAIL &lt;0.98; REVIEW 0.98–0.995 |
| MAIN.SUBJECT_FRAME_EXTENT | amazon.subjectExtent.v1 | HIGH | no | extent ≥0.85 when mask conf ≥0.90 else REVIEW |
| MAIN.NOT_CROPPED | amazon.edgeMargin.v1 | HIGH | no | margin ≥1%; touch-edge FAIL if confident |
| MAIN.NO_OVERLAY_TEXT | amazon.overlayText.v1 | HIGH | no | OCR ≥0.90 off-print FAIL |
| MAIN.NO_BORDER_OR_WATERMARK | amazon.borderWatermark.v1 | HIGH | no | Hybrid pixel + Fake Vision |
| MAIN.ONLY_SOLD_ITEMS | amazon.soldItems.v1 | HIGH | no | REVIEW default; FAIL only with inventory+mask conflict |
| PRODUCT.IDENTITY | product.identity.v1 | HIGH | no | geometry/logo/ports/controls/material/itemCount |
| QUALITY.BLUR | image.blur.v1 | MEDIUM | no | Laplacian profile `product-2k-v1` |
| PRODUCT.FACT_TEXT_MATCH | ocr.factMatch.v1 | HIGH | no | Confirmed brand/model/sku/capacity vs OCR |

## Changelog

| Date (Asia/Shanghai) | Version | Change |
|---|---|---|
| 2026-09-12 | 1 | Initial pack for W6 Phase 1 (Fake Provider + 3 synthetic SKUs). |

Phase 2 (real Provider / real SKU eval) is hung per ADR-0003 and will land as new CRs.
