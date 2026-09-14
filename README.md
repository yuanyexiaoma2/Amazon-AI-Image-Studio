# Amazon AI Image Studio

MVP monorepo for Amazon product-image production (W0–W2: auth, projects, upload pipeline, Truth Pack).

> **Audience:** programming beginners welcome. Follow the steps below in order.

## What this repo is

- **Web app** (`apps/web`): Next.js App Router — auth, projects, **asset upload + Truth Pack UI**, canvas stub.
- **Worker** (`apps/worker`): BullMQ — health + **asset inspect** (MIME/thumbnail/version).
- **Shared packages**: domain, contracts, db, storage, providers (Fake image + Fake vision), config, **imaging**.
- **Spec**: `docs/specs/amazon-ai-image-studio-v1.1.md`
- **Progress**: `docs/progress.md`


## Branch policy

- **Do not** push feature or fix commits directly to `main`.
- Use `feat/**` / `feature/**` / `fix/**` branches and open a Pull Request (same-week related work → one milestone PR; see `AGENTS.md`).
- `main` accepts merges only after review + green CI.

## Auth (MVP)

- Auth.js **Credentials + JWT Session** (24h `maxAge`).
- `User.sessionVersion` invalidates JWTs on password change/reset/disable.
- See `docs/adr/0002-auth-jwt-session.md` and `docs/architecture.md` (deviation from v1.1 DB-session preference).

## Prerequisites

- Node.js **22+** (CI uses Node 22 LTS)
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


## Try upload locally (W2)

1. Start infra + migrate (see Quick start).
2. Terminal A: `INSPECT_INLINE=1 pnpm dev` (inline inspect is easiest for beginners; or run `pnpm worker` separately without inline).
3. Register / login at http://localhost:3000
4. Open **Projects**, create a SKU, open the project.
5. Upload a PNG/JPEG/WebP (≤20MB). Wait until asset status is `READY`.
6. Click **Extract (Fake Vision)** → **Confirm all EXTRACTED** → **Approve revision**.

## V2: 意图向导 + 真实 AI（owner self-use）

- 项目页点 **意图向导**：一句话意图 → AI 规划 7 张图的卖点/场景 → 批准 → 物化到 Studio 画布。
- 真实 AI 需要 `.env` 里 `PLANNER_PROVIDER=kie` + `IMAGE_PROVIDER=kie` + `KIE_API_KEY`（单 key 双用途；kie LLM 端点细节见 `docs/specs/v2-vision.md` §5）。
- 愿景与路线图：`docs/specs/v2-vision.md`。当前 PR 序列：V2-A(planner) → PR-2 画布命令层 → PR-1 UI 重构 → PR-4 聊天 Agent。

Object storage is MinIO (`S3_*` in `.env`). Never add real AI provider API keys — Fake Provider only until W0-02 is unblocked.

Synthetic eval fixtures: `pnpm fixtures:synth` → `fixtures/eval-products/`.

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
