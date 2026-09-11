# Architecture (living) — Amazon AI Image Studio

> Keep this file aligned with ADRs. Do not silently drift from `docs/specs/amazon-ai-image-studio-v1.1.md`.

## Monorepo

- `apps/web` — Next.js App Router + Auth.js
- `apps/worker` — BullMQ worker (Redis)
- `packages/*` — domain, contracts, db, storage, providers, config

## Branch policy

- **Never push feature/fix work straight to `main`.**
- All feature and fix work lands via PR (`feat/**`, `fix/**`) into `main`.
- `main` is integration-only after review/CI.

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

## Storage

- Object storage port in `@studio/storage` with `MemoryObjectStorage` (unit) and
  `S3ObjectStorage` (MinIO / S3) for CI and local compose.

## Providers

- Default Fake Provider until keys authorized (ADR-0001). W0-02 remains `BLOCKED_EXTERNAL`.

## CI

GitHub Actions verifies Postgres, Redis, MinIO health; runs `prisma migrate deploy`;
unit + integration tests; build; real API E2E (`pnpm test:e2e`).
