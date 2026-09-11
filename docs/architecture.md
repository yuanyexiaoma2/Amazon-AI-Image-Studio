# Architecture (living) — Amazon AI Image Studio

> Keep this file aligned with ADRs. Do not silently drift from `docs/specs/amazon-ai-image-studio-v1.1.md`.

## Monorepo

- `apps/web` — Next.js App Router + Auth.js
- `apps/worker` — BullMQ worker (Redis): health + **asset inspect**
- `packages/*` — domain, contracts, db, storage, providers, config, **imaging**

## Branch & review policy (see also `AGENTS.md`)

- **Never push feature/fix work straight to `main`.**
- Same-week related features → **one feature branch + one milestone PR**.
- Continuous commits OK; every commit should keep lint/typecheck/test/build runnable.
- After feature complete + CI green → one independent review. Implementer marks **DONE**; **VERIFIED** is weekly/high-risk only.
- High-risk always need independent review before merge: auth, tenant isolation, **DB migrations**, billing, real Provider calls, queue idempotency, deletion, compliance export.
- Pure docs/copy/style/test-maintenance with CI green + no behavior change → can merge directly.
- W2 acceptance unit = **upload → inspect → thumbnail → version → Truth Pack**.

## Auth (deviation from v1.1)

v1.1 preferred **database sessions**. MVP uses:

- Auth.js **Credentials** + **JWT Session**
- JWT `maxAge` = 24 hours
- `User.sessionVersion` for revocation
- Protected APIs: `requireActiveSession()` validates ACTIVE + version match
- Shared `PasswordSchema` (min 12 / max 128) for register **and** change-password
- Shared `normalizeEmail()` (trim → NFKC → lower) for register / lookup / login
- Login failure rate limit via Redis: IP + normalized email, max 5 failures / 15 minutes (HTTP 429). Failures for unknown email and bad password share the same counter path (no registration leak).
- **Forgot-password reset** is a separate future task (W1-09) — not the same as authenticated change-password.

See ADR-0002 and CR-0001. Prisma still retains `sessions` / `accounts` for future OAuth
and potential rollback to DB sessions.

## Tenancy

- `workspace_id` on tenant-owned rows; repository APIs require workspace scope.
- Cross-workspace access returns 403 at the API layer.
- Composite FKs `(workspace_id, parent_id)` on W2 asset / truth tables.

## Storage & upload pipeline (W2)

- Object storage port in `@studio/storage` with `MemoryObjectStorage` (unit) and
  `S3ObjectStorage` (MinIO / S3) for CI and local compose.
- Presigned **PUT** upload → `complete` → BullMQ `asset-inspect` (or `INSPECT_INLINE=1`).
- Inspect (`@studio/imaging`): magic-byte MIME, size/pixel limits, sRGB normalize PNG, 512 WebP thumbnail, checksum, immutable `AssetVersion` + representations.
- Object keys: `workspaces/{ws}/projects/{p}/assets/{a}/original|normalized|thumbnails/...`

## Product Truth Pack (W2)

- `product_truth_documents` / `revisions` / `facts` / `constraints`
- Extract via **Fake Vision Provider** only while W0-02 is `BLOCKED_EXTERNAL`
- Confirm / lock / reject facts; approve gate requires no remaining `EXTRACTED` facts

## Providers

- Default Fake Provider until keys authorized (ADR-0001). W0-02 remains `BLOCKED_EXTERNAL`.
- Never store real provider keys in repo / `.env.example` / commits.

## CI

GitHub Actions verifies Postgres, Redis, MinIO health; runs `prisma migrate deploy`;
unit + integration tests; build; real API E2E (`pnpm test:e2e`) including upload→Truth Pack when services are up.
Triggers on `main`, `feat/**`, `feature/**`, `fix/**`.
