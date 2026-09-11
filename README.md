# Amazon AI Image Studio

Greenfield MVP scaffold for an Amazon product-image production studio (Web + Worker monorepo).

> **Audience:** programming beginners welcome. Follow the steps below in order.

## What this repo is

- **Web app** (`apps/web`): Next.js App Router — home, register/login stubs, canvas stub (`@xyflow/react`).
- **Worker** (`apps/worker`): BullMQ worker talking to Redis (health/noop job).
- **Shared packages**: domain rules, Zod API contracts, Prisma DB, S3/MinIO storage stubs, Fake image provider, env/logging.
- **Spec**: `docs/specs/amazon-ai-image-studio-v1.1.md`
- **Progress**: `docs/progress.md`


## Branch policy

- **Do not** push feature or fix commits directly to `main`.
- Use `feat/**` / `fix/**` branches and open a Pull Request.
- `main` accepts merges only after review + green CI.

## Auth (MVP)

- Auth.js **Credentials + JWT Session** (24h `maxAge`).
- `User.sessionVersion` invalidates JWTs on password change/reset/disable.
- See `docs/adr/0002-auth-jwt-session.md` and `docs/architecture.md` (deviation from v1.1 DB-session preference).

## Prerequisites

- Node.js **20+**
- [pnpm](https://pnpm.io/) 9 (`corepack enable` then `corepack prepare pnpm@9.15.0 --activate`, or `npm i -g pnpm`)
- Docker (for Postgres, Redis, MinIO)

## Quick start

```bash
# 1) Install JS dependencies
pnpm install

# 2) Start databases / queue / object storage
docker compose -f infra/docker-compose.yml up -d postgres redis minio

# 3) Environment file (never commit real secrets)
cp .env.example .env
# Generate AUTH_SECRET, e.g.: openssl rand -base64 32

# 4) Prisma client + migrate
pnpm db:generate
pnpm db:migrate

# 5) Run web (http://localhost:3000)
pnpm dev

# 6) In another terminal — worker
pnpm worker
```

### Health checks

```bash
docker exec studio-postgres pg_isready -U studio -d studio
docker exec studio-redis redis-cli ping
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9000/minio/health/live
```

MinIO console: http://localhost:9001 (user/pass from `.env.example`).

## Quality commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm openapi:generate   # writes docs/api/openapi.yaml from Zod contracts
```

## Monorepo layout

```text
apps/web          Next.js UI + Auth.js
apps/worker       BullMQ jobs
packages/domain   Pure business rules
packages/contracts Zod schemas → OpenAPI
packages/db       Prisma schema + repositories
packages/storage  S3/MinIO ports (memory stub)
packages/providers Fake Provider (+ ports)
packages/config   Env (zod) + pino logger
infra/            docker-compose.yml
docs/             specs, progress, ADR, runbooks
```

## Auth notes (beginner-friendly)

- Register at `/register` (email + password). Password is hashed with **Argon2id**.
- Login at `/login` via Auth.js Credentials.
- Auth.js cannot attach **database** sessions to the Credentials provider, so MVP uses **JWT sessions** (24h) plus `User.sessionVersion` revocation (ADR-0002 / CR-0001).
- Prisma still has `sessions` / `accounts` tables for future OAuth and rollback.
- Protected APIs use `requireActiveSession()` (active user + matching `sessionVersion`).

## Provider notes

Until API keys are authorized, image generation uses **Fake Provider** (`packages/providers`). See `docs/adr/0001-provider-capability.md`.

## License / branding

Internal MVP scaffold. Do **not** copy third-party site trademarks or UI.
