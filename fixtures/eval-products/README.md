# Eval product fixtures (W2-07)

## Status: BLOCKED_EXTERNAL

Spec W2-07 asks for **10 real SKUs** as an evaluation baseline. This milestone ships **3 synthetic SKUs**
because licensed real product photography / marketplace dumps were not available in-repo.

**Do not mark W2-07 DONE or VERIFIED** until 10 real SKUs land. Synthetic fixtures do not satisfy acceptance.

| SKU | Kind | Notes |
|---|---|---|
| SKU-SYN-001 | Synthetic mug | Manifest + generated white-bg PNG via `pnpm fixtures:synth` |
| SKU-SYN-002 | Synthetic bottle | Same |
| SKU-SYN-003 | Synthetic earbud case | Same |

**Gap to close later:** replace/extend with 10 real SKUs (with rights clearance), golden Truth Packs,
and `pnpm test:eval` baseline report. Do not mark W2-07 VERIFIED until real SKUs land.

## Layout

```text
fixtures/eval-products/<SKU>/
  product.json      # sku, category, expected facts
  images/           # reference PNGs (generated)
```
