# Self-serve setup (owner self-use) — P2-A kie.ai

Non-engineer friendly path: **clone → env → run → export**.  
Product mode: **owner self-use** (not public release). Formal eval / UAT is **not** required for acceptance — owner real trial is enough (MSG-035 / MSG-036).

> Secrets never go in git. Only copy placeholders from `.env.example` into a local `.env`.

## 0. Prerequisites

- Node.js **22+**
- [pnpm](https://pnpm.io/) 9.x (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Docker Desktop (or Docker Engine) for Postgres / Redis / MinIO
- A kie.ai account + API key: https://kie.ai/api-key  
  Docs: https://docs.kie.ai/

## 1. Clone

```bash
git clone https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio.git
cd Amazon-AI-Image-Studio
pnpm install
```

## 2. Local infra

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis minio
# (or: docker compose -f compose.yaml up -d — see repo root)
```

Wait until Postgres accepts connections, then:

```bash
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## 3. Env — pick Fake or kie

### A) Fake (default, no paid calls)

Leave:

```env
IMAGE_PROVIDER=fake
```

### B) Real kie.ai gateway (P2-A)

Edit `.env` (local only):

```env
IMAGE_PROVIDER=kie
KIE_BASE_URL=https://api.kie.ai
KIE_API_KEY=paste-your-key-here
# Optional overrides — must be real Market model IDs from docs.kie.ai:
# KIE_MODEL_GENERATE=seedream/5-pro-text-to-image
# KIE_MODEL_EDIT=seedream/5-pro-image-to-image
# Optional dual-channel webhook HMAC (Settings → Webhook HMAC Key):
# KIE_WEBHOOK_HMAC_KEY=
```

**Credits balance API (documented):** `GET https://api.kie.ai/api/v1/chat/credit`  
(MSG-036 draft said `/api/v1/user/credits`; Studio uses the **documented** `/api/v1/chat/credit` path.)

**Retention:** kie keeps generated media ~**14 days**. Studio **downloads immediately** and stores in MinIO (`S3_*`).

**Rate limit:** ~**20 createTask / 10 seconds** per account. Worker concurrency is capped (`KIE_WORKER_CONCURRENCY_CAP`, default 4) and create calls use an in-process limiter; HTTP 429 maps to `RATE_LIMIT` retries.

## 4. Run

Terminal A — web:

```bash
pnpm dev
```

Terminal B — worker (required for real generate unless `GENERATION_INLINE=1`):

```bash
pnpm worker
```

Open http://localhost:3000 — register / login, create a project, upload product assets, approve Truth Pack, materialize Shot Plan, run generate.

Optional in-process (no BullMQ) for a quick smoke:

```env
GENERATION_INLINE=1
INSPECT_INLINE=1
QA_INLINE=1
EXPORT_INLINE=1
```

## 5. Export

After review / QA:

1. Open the project Review / Export UI.
2. Run Amazon QA if needed; human **Approve** slots you want.
3. Create an export bundle (ZIP) — download from the UI.

Media in MinIO survives beyond kie’s 14-day gateway retention.

## 6. Acceptance (self-use)

| Check | Pass when |
|---|---|
| Clone + migrate | App boots locally |
| Fake path | Generate works with `IMAGE_PROVIDER=fake` |
| kie path | With your key, one generate finishes and image appears in Studio / MinIO |
| Export | ZIP downloads |

No formal §18.4 reviewer sample required for self-use. If the product later becomes **multi-user / company formal use**, revive formal eval (see ADR-0003 recovery).

## 7. Troubleshooting

| Symptom | What to try |
|---|---|
| `KIE_API_KEY is required` | Set key in `.env`, restart web + worker |
| HTTP 401 | Regenerate key at https://kie.ai/api-key |
| HTTP 402 / QUOTA | Top up credits; Studio also checks `GET /api/v1/chat/credit` before create |
| HTTP 429 / RATE_LIMIT | Wait; lower `WORKER_CONCURRENCY`; Studio retries with backoff |
| Empty image | Confirm MinIO is up; check worker logs for media download allowlist errors |
| Webhook not arriving | Poll still works; set public `APP_URL` + `callBackUrl` only if you need dual channel |

## References

- Provider port: `packages/providers` (`KieImageProviderAdapter`)
- ADR-0001 / ADR-0003
- Progress ledger P2-A section in `docs/progress.md`
