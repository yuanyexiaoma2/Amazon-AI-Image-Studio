# Eval product fixtures

## Status

| Milestone | Status | Notes |
|---|---|---|
| W2-07 (10 real SKUs) | **BLOCKED_EXTERNAL** | Owner deferred material collection (ADR-0003). |
| W8-01 Phase 1 | **DONE (Fake)** | Uses **3 synthetic SKUs** + golden QA scenarios under `golden-qa/`. |

Spec W2-07 / §32.10 ask for 10→20 real SKUs. This repo ships **3 synthetic SKUs** so W8 can produce a Fake baseline report without inventing rights-cleared photography.

| SKU | Kind | Notes |
|---|---|---|
| SKU-SYN-001 | Synthetic mug | `product.json` + `eval-briefs.json` + generated PNG |
| SKU-SYN-002 | Synthetic bottle | Same |
| SKU-SYN-003 | Synthetic earbud case | Same |

**Do not mark W2-07 VERIFIED** until 10 real SKUs land.

## Layout

```text
fixtures/eval-products/<SKU>/
  product.json
  eval-briefs.json   # W8-01 MAIN/FEATURE/LIFESTYLE × 2 candidates
  images/
golden-qa/
  *.json             # Fake scenario → expected overall (Phase 1 compact set)
```

## Commands

```bash
pnpm fixtures:synth
pnpm test:eval          # Fake baseline → docs/eval/w8-phase1-baseline-report.md
pnpm test:stress-30     # 30-item Fake batch / outbox uniqueness report
```
