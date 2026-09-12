# Golden QA scenarios (W8-01 Phase 1)

Hard-rule golden set for Fake OCR/Vision evaluators. Spec §32.10 asks ≥60 fixtures with ≥10 per violation class; **Phase 1** ships a compact synthetic matrix covering each Fake failure type at least once across the 3 SKUs. Full 60+ real-SKU golden set remains Phase 2 (ADR-0003 / W2-07).

| Scenario file | Fake scenario | Expected overall |
|---|---|---|
| `pass.json` | SUCCESS | PASS |
| `overlay-text.json` | OVERLAY_TEXT | BLOCK |
| `structure-change.json` | STRUCTURE_CHANGE | BLOCK |
| `logo-change.json` | LOGO_CHANGE | BLOCK |
| `composition-drift.json` | COMPOSITION_DRIFT | REVIEW or BLOCK |
| `attachment-count.json` | ATTACHMENT_COUNT | REVIEW or BLOCK |
| `identity-mismatch.json` | IDENTITY_MISMATCH | BLOCK |
| `watermark.json` | WATERMARK | BLOCK |
| `fact-mismatch.json` | FACT_MISMATCH | BLOCK |
| `low-confidence.json` | LOW_CONFIDENCE | REVIEW |

Run: `pnpm test:eval`
