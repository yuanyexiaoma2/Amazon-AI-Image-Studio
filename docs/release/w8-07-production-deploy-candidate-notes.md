# W8-07 — Production deploy **candidate** notes

> **Not an authorization to go live.** Spec §32.15 / W9-02 require explicit Production publish authorization.

## What this candidate includes

- Full Fake Phase 1 path: upload → Truth → Plan → Studio → QA → Review → Export → Variants → Admin.
- W8 hardening: Fake eval baseline (3 SKUs), prompt/QA tune, queue concurrency/backpressure, security tests, ops runbooks, cheap a11y fixes, UAT/release checklists.

## Hard blockers before Production

1. **W0-02 / ADR-0001** — authorized Provider keys via secret store (never commit to git).
2. **W2-07** — ≥10 rights-cleared real SKUs + Phase 2 eval.
3. **W4-07** — Staging real generate/edit smoke.
4. **§18.4** — human first-pass / retry thresholds met or written exception by owner.
5. **W9-02** — signed Production publish authorization artifact.

## Deploy shape (candidate)

- App: web + worker containers; Postgres; Redis; object storage.
- Env: `IMAGE_PROVIDER=fake` until keys authorized; then switch via config activation — not by baking keys into images.
- Migrations: `pnpm db:migrate:deploy` forward-only.
- Rollback: previous image tag within 30 minutes; DB restore only via drill-tested dump.

## Secrets (placeholders only)

```text
AUTH_SECRET=<secret-store>
DATABASE_URL=<secret-store>
REDIS_URL=<secret-store>
S3_* =<secret-store>
FAKE_WEBHOOK_SECRET=<staging-only>
# REAL_PROVIDER_KEY — NOT PRESENT until W0-02
```
