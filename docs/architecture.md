# Architecture (living) — Amazon AI Image Studio

> Keep this file aligned with ADRs. Do not silently drift from `docs/specs/amazon-ai-image-studio-v1.1.md`.

## Monorepo

- `apps/web` — Next.js App Router + Auth.js
- `apps/worker` — BullMQ worker (Redis): health + **asset inspect** + **generation-attempt** + **qa-evaluate** + **export-bundle**
- `packages/*` — domain, contracts, db, storage, providers, config, **imaging**

## Branch & review policy (see also `AGENTS.md`)

- **Never push feature/fix work straight to `main`.**
- Same-week related features → **one feature branch + one milestone PR**.
- Continuous commits OK; every commit should keep lint/typecheck/test/build runnable.
- After feature complete + CI green → one independent review. Implementer marks **DONE**; **VERIFIED** is weekly/high-risk only.
- High-risk always need independent review before merge: auth, tenant isolation, **DB migrations**, billing, real Provider calls, queue idempotency, deletion, compliance export.
- Pure docs/copy/style/test-maintenance with CI green + no behavior change → can merge directly.
- W2 acceptance unit = **upload → inspect → thumbnail → version → Truth Pack**.
- W8-01…07 **VERIFIED** on main `c57e316` (PR #18). W9 is docs-only buffer + release (`docs/release/`); no new product modules.

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
- Presigned **PUT** upload → `complete` pre-checks (size / Content-Type / animated WebP) → **transactional outbox** (`outbox_messages`) in the same DB tx as `INSPECTING` → BullMQ publish with stable `jobId` (`inspect-<uploadId>`). Publish failure leaves `PENDING` for worker/API recovery relay. `INSPECT_INLINE=1` is e2e-only.
- Inspect (`@studio/imaging`): idempotent (one version + one representation/kind); magic-byte MIME, size/pixel limits, reject animated WebP; sRGB normalize PNG (EXIF stripped; original object never overwritten); 512 WebP thumbnail; checksum. Transient S3/DB errors throw for retry; only definitive validation marks `REJECTED`.
- Object keys: `workspaces/{ws}/projects/{p}/assets/{a}/original|normalized|thumbnails/...`
- `completionKey` unique per `(workspaceId, completionKey)`; composite FKs on current/approved/parent pointers.

## Product Truth Pack (W2)

- `product_truth_documents` / `revisions` / `facts` / `constraints`
- Extract via **Fake Vision Provider** only while W0-02 is `BLOCKED_EXTERNAL`
- Confirm / lock / reject facts; approve requires `PENDING_REVIEW` **current** revision of the project document; roles OWNER/ADMIN/REVIEWER only; evidence AssetVersions must be in the same workspace+project

## Providers

- Default Fake Provider until keys authorized (ADR-0001). W0-02 remains `BLOCKED_EXTERNAL`.
- Never store real provider keys in repo / `.env.example` / commits.

## CI

GitHub Actions verifies Postgres, Redis, MinIO health; runs `prisma migrate deploy`;
unit + integration tests; build; real API E2E (`pnpm test:e2e`) including upload→Truth Pack when services are up.
Push triggers: `main`, `feat/**`, `feature/**`, `fix/**`. **Pull requests targeting `main` also run CI** (including `docs/**` buffer PRs).
`pnpm test:eval` / `test:stress-30` are local/report jobs (not in CI yet — see `docs/release/backlog.md` PERF-01).

## Studio canvas (W3-B1 + W3-B2)

- `@xyflow/react` three-pane Studio (node library / canvas / properties + task drawer stub).
- Graph rules (ports, self-loop, duplicates, cross-layer back-edges, cycles) live in `@studio/domain` as pure functions; UI and API both call domain validation.
- Drafts: `workflow_drafts.revision_number` optimistic concurrency via `ifRevision`; conflicts return **409 WORKFLOW_REVISION_CONFLICT** (no silent overwrite). Immutable snapshots in `workflow_revisions`.
- W3-B2: Zod node config schemas in `@studio/contracts` (11 palette + system `approval_selector`); canvas undo/redo, copy/paste, delete impact hint, fit view, `isValidConnection` preview; `POST .../shot-plans/materialize` consumes W3-A `canvasPayload` unchanged and app-validates `referencedAssetVersionIds` (no DB FK). Fake only — no real Provider execution.


## W4 runtime (generation / credits / webhook / SSE)

- `ImageProviderAdapter` (§9.1) with **FakeImageProviderAdapter** only while W0-02 blocked.
- Model Registry server-owned (`GET .../model-registry`); capability snapshot stored on each `generation_attempts.model_snapshot_json`.
- Billing order: estimate → budget confirm → txn (Run + Attempt + credit RESERVE + Outbox) → BullMQ → settle/refund. Ledger is append-only (`credit_ledger_events`); `credit_accounts` snapshot updated only inside that write path.
- Webhook: raw body HMAC; idempotent `provider_events`; unknown external job does not guess-match.
- SSE: `GET .../events?projectId=` streams `progress_events` (poll-backed).
- Retry policy (§9.3): AUTH/VALIDATION/POLICY/QUOTA no auto-retry; RATE_LIMIT/TRANSIENT with backoff; TIMEOUT ≤2; UNKNOWN once.

## W5-A executors (generate / fingerprint / remove_background)

- Node executors still dispatch via W4 Run → Attempt → Outbox → `generation-attempt` worker (or `GENERATION_INLINE`).
- Input fingerprint: RFC 8785 JCS → SHA-256 in `@studio/domain` (`input-fingerprint.ts`); stored on `generation_attempts.input_fingerprint` and `node_results`.
- STALE: `node_results.status=STALE` (+ optional `generation_outputs.disposition=STALE`); BFS descendants per §32.2; Truth approve + workflow snapshot graph-diff apply propagation. Does not delete outputs.
- `remove_background`: Fake returns IMAGE + MASK; worker ingests GENERATED + MASK AssetVersions (full request WxH on version metadata).
- Webhook early-arrival: unknown `externalJobId` stored with `processedAt=null` (orphan); reconciled when `provider_submissions` row appears; `processedAt` set only after successful apply.
- Fake only while ADR-0003 / W0-02 BLOCKED_EXTERNAL.


## W6 Phase 1 — QA / Review / Export (Fake)

- Market Rule Pack `amazon-main-us-v1` is versioned JSON (`docs/qa-rules/`) loaded by `@studio/domain`. Thresholds are not scattered in evaluators.
- QA dispatch: `POST .../asset-versions/{id}/qa` writes `qa_reports` QUEUED + outbox `qa-evaluate-{reportId}` (or `QA_INLINE` / `INSPECT_INLINE`).
- Layers: pixel metrics (`@studio/imaging`) → Fake OCR / Fake Vision QA → pure evaluators → §31.14 aggregate PASS/REVIEW/BLOCK.
- Finding evidence regions are normalized `[0,1]`. `FILE.DECODABLE` is nonWaivable.
- Approvals are append-only (`APPROVE | REJECT | OVERRIDE_BLOCK | REVOKE`). `qa_gate` PASS never substitutes human Approval. OWNER/ADMIN/REVIEWER may approve PASS/REVIEW; only OWNER/ADMIN may OVERRIDE_BLOCK (reason required). nonWaivable FAIL cannot be overridden.
- Export re-checks effective approval + nonWaivable + MAIN hard BLOCK in the API; Worker builds deterministic STORE ZIP (`manifest.json`, `qa-report.csv`, images) with bundle `createdAt` timestamps and SHA-256 checksums.
- Phase 2 real Provider / real SKU eval remains hung (ADR-0003).


## W7 — Variants / batch / admin (Fake)

- Variant entities + batch-derive from approved master (no Approval inherit).
- Per-item reserve/settle/refund; `BUDGET_EXCEEDED` unless confirmBudget; item retry.
- Variant QA via W6 Fake Vision scenarios; export filters non-PASS.
- Admin jobs / credit ADJUST / reconciliation — OWNER/ADMIN.
- Runbooks: `docs/runbooks/variant-batch.md`, `credit-reconciliation.md`, `provider-outage-stuck-jobs.md`.

## W8 — Hardening (Phase 1 Fake, VERIFIED)

- Fake visual eval on **3 synthetic SKUs** + golden QA; prompt/QA pack v2; 30-item Fake load + queue backpressure.
- Security checklist tests (authz, signed URL TTL, SSRF refusal, webhook HMAC, log redact).
- Backup/restore + user-delete runbooks (drill tables unsigned).
- Cheap a11y/empty/error landmarks on Review + Studio.
- Release candidate notes: `docs/release/w8-07-*.md`. Not a Production go-live.

## W9 — Buffer + release (docs only)

- No new product modules (spec §19.9). No 3D / Listing / translation / collab / UI redesign / stack swap.
- Living release pack:
  - `docs/release/go-no-go.md` — **CONDITIONAL GO** Fake/Phase 1; **NO-GO** real Production until W0-02 / W2-07 / W4-07 + Phase 2 + signed §32.15.
  - `docs/release/backlog.md` — hung external deps, provider/docs gaps, visual/perf/security leftovers, UAT P0/P1 tracker, second-provider skip.
  - `docs/release/monitoring.md` — alert ownership **placeholders** (owner to fill). Do not claim monitors are staffed.
- `W9-02` Production publish remains `BLOCKED_EXTERNAL`. Production smoke was **not** run.
