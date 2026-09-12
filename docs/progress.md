# Progress ledger — Amazon AI Image Studio

> Synced from spec §24. Status legend: `TODO` → `IN_PROGRESS` → `DONE` → `VERIFIED` | `BLOCKED` | `BLOCKED_EXTERNAL`.
> **VERIFIED requires an independent reviewer or a fresh AI context** that re-ran acceptance checks.
> Implementing agents mark at most `DONE` with evidence — never self-`VERIFIED`.

**Repo type (W0-01):** GREENFIELD — empty public GitHub repo; no prior application code.

**Timezone note:** W2 milestone work 2026-09-11 Asia/Shanghai (UTC+8). W3-A / W3-B1 / W3-B2 / W4 / W5-A / W5-B / W5-C work 2026-09-12 Asia/Shanghai (UTC+8).

---

## Review policy (documented W2)

See `AGENTS.md` and `docs/architecture.md`: same-week related work → one milestone PR; continuous commits OK; DONE by implementer; VERIFIED at weekly/high-risk review; W2 acceptance = full upload→Truth Pack chain. W3 is split into W3-A / W3-B1 / W3-B2; W5 into W5-A / W5-B / W5-C (Kimi MSG-016); each is one milestone PR + one independent review.

---

## W0 / W1 status

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W0-01 | Baseline Audit | DONE | Empty clone of `yuanyexiaoma2/Amazon-AI-Image-Studio`. No existing app/tests. Capability map: none. |
| W0-02 | Provider Capability / authorization | BLOCKED_EXTERNAL (ADR-0001 + ADR-0003) | ADR `docs/adr/0001-provider-capability.md` + **ADR-0003**. Fake Provider default. **所有者裁决：推迟至开发全部完成后决定（密钥选型 + 素材收集）**. Never store real provider keys. |
| W1-01 | Init monorepo | VERIFIED | pnpm workspace; apps + packages. Second independent review on prior HEAD. |
| W1-02 | Eng quality + CI | VERIFIED | TS strict; Vitest; CI services; Node 22. |
| W1-03 | Local infra | VERIFIED | Postgres/Redis/MinIO compose. |
| W1-04 | Env + logging | VERIFIED | `@studio/config` Zod env. |
| W1-05 | Auth.js + register/login | VERIFIED | JWT + sessionVersion; rate limit; PasswordSchema. |
| W1-06 | Prisma tenant schema | VERIFIED | UUIDv7; workspace-scoped repos. |
| W1-07 | OpenAPI + errors + request ID | VERIFIED | `pnpm openapi:generate`; `x-request-id`. |
| W1-08 | Docs skeleton | VERIFIED | Spec; progress; ADRs; AGENTS.md. |
| W1-09 | Forgot-password reset | TODO | Unscheduled; not in current roadmap. One-time token, SHA-256 in DB, 30m expiry, Local Mail Capture. |

---

## W2 — Assets + Truth Pack

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W2-01 | Presigned Upload, complete, Worker inspect job | VERIFIED | Presign/complete + transactional outbox (`outbox_messages`) + BullMQ stable `jobId`; recovery relay; `INSPECT_INLINE` for e2e only. Migrations `20260911180000_*` + `20260911190000_w2_outbox_tenant_hardening`. Independent review APPROVED on PR #3; merged to main as `79996ac9cd0f3e824bc1c0a608c4aa9d75fbcaa6`; main CI green https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34586631130. |
| W2-02 | MIME/pixels/safety/sRGB/thumbnail/checksum | VERIFIED | `@studio/imaging` + domain sniff/limits; ORIGINAL + NORMALIZED_PNG + THUMBNAIL_WEBP reps. Independent review APPROVED on PR #3; merged to main as `79996ac9cd0f3e824bc1c0a608c4aa9d75fbcaa6`; main CI green https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34586631130. |
| W2-03 | Asset / Version / Mask models + asset library UI | VERIFIED | Prisma models; `/projects` + project detail asset list; soft-delete asset API. Mask table present (strokes UI later weeks). Independent review APPROVED on PR #3; merged to main as `79996ac9cd0f3e824bc1c0a608c4aa9d75fbcaa6`; main CI green https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34586631130. |
| W2-04 | Product Truth Pack form, fact status, evidence refs | VERIFIED | Truth document/revision/facts/constraints; GET/PUT truth-pack; UI form actions. Independent review APPROVED on PR #3; merged to main as `79996ac9cd0f3e824bc1c0a608c4aa9d75fbcaa6`; main CI green https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34586631130. |
| W2-05 | Vision Provider Adapter + structured extract | VERIFIED | `VisionProvider` + **FakeVisionProvider** only (W0-02 still BLOCKED_EXTERNAL). `POST .../truth-pack/extract`. Independent review APPROVED on PR #3; merged to main as `79996ac9cd0f3e824bc1c0a608c4aa9d75fbcaa6`; main CI green https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34586631130. |
| W2-06 | Fact confirm / lock-allow / approve gate | VERIFIED | confirm + approve APIs; domain `canApproveTruthRevision`; UI buttons. Independent review APPROVED on PR #3; merged to main as `79996ac9cd0f3e824bc1c0a608c4aa9d75fbcaa6`; main CI green https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34586631130. |
| W2-07 | Fixture baseline (10 real SKUs) | BLOCKED_EXTERNAL | Only **3 synthetic SKUs** in `fixtures/eval-products/`. **所有者裁决：推迟至开发全部完成后决定（密钥选型 + 素材收集）**（原「QA 周前到位」作废）。见 ADR-0003。Does not block core merge; must **not** be VERIFIED. |

### W2 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260911180000_w2_assets_truth_pack` |
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm test:e2e` | Extends to upload→inspect→extract→confirm→approve (with MinIO + `INSPECT_INLINE=1`) |
| Secrets | No real provider keys in repo / `.env.example` / commits |

**VERIFIED evidence package (W2-01…W2-06):**
- Merge SHA: `79996ac9cd0f3e824bc1c0a608c4aa9d75fbcaa6` (PR #3 squash into main)
- Main CI green: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34586631130
- 审稿 **APPROVED** on PR #6 (ratification of merge `79996ac` + CI `34586631130`)
- PR #3 final HEAD before merge: `322ba52de47a3c00be2c20422f26933ef7022ef8`

**W2-07** remains BLOCKED_EXTERNAL：素材由项目所有者按 fixtures 现有格式提供，QA 周前到位。

---

## W3 milestones (split)

**Why split:** Spec §19.3 packs Shot Plan (domain/API) and full Studio canvas (xyflow + 11 nodes + autosave + materialize) into one week. For one-PR / one-review cadence, that is too large and mixes high-risk graph UX with plan CRUD. Split into two independently reviewable milestones.

### W3-A — Shot Plan + plan approve (do first)

**Branch:** `feature/w3a-shot-plan`  
**Acceptance unit (one PR, one independent review):** W3-01 + W3-02

- Shot Plan / Shot Brief + default 7-image template
- AI plan draft (Fake planner while W0-02 blocked) + human approve gate
- Gate: from approved Truth Pack → editable plan → approve; tenant-scoped; tests + CI green

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W3-01 | Shot Plan/Brief + 7-image template | DONE | Domain `shot-plan.ts` §11.1 default 7 (no PACKAGE); Prisma `shot_plan_*` + `shot_briefs`; tenant UUIDv7; revision **FK `truth_revision_id` → approved Truth revision**; contracts + `canvasPayload` for W3-08; migration `20260912010000_w3a_shot_plan`. Fake only. |
| W3-02 | Plan generate + approve | DONE | `POST .../shot-plans/generate` (FakeShotPlanProvider); PUT human edit; **atomic approve** (W2 Truth structure: FOR UPDATE + PENDING_REVIEW + row counts + audit_events); roles WRITE OWNER/ADMIN/MEMBER, APPROVE OWNER/ADMIN/REVIEWER; cannot generate/approve without approved Truth; unit + integration + e2e; no W3-B (no xyflow/canvas/materialize). |

### W3-A commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260912010000_w3a_shot_plan` |
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm test:e2e` | Extends W2 chain with generate→edit→approve Shot Plan (`INSPECT_INLINE=1`) |
| Provider | **FakeShotPlanProvider only** (W0-02 BLOCKED_EXTERNAL); no real keys |
| Out of scope | W3-B canvas / xyflow / autosave / materialize / node registry |

**DONE evidence package (W3-01…W3-02):**
- Branch HEAD: `5ec70d53dd53575f1db03e8ded3a6bc90602db11`
- Milestone PR (open, **not merged**): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/8
- CI green (pull_request): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34662767687
- Local e2e: W2 Truth approve → Fake generate 7 briefs → PUT edit → Shot Plan approve
- Implementer marks **DONE** only — **VERIFIED** requires 审稿 public APPROVED on PR #8 before merge

### W3-B split (MSG-007)

**Why further split B:** Spec §19.3 still packs xyflow layout + graph engine + autosave + 11 node schemas + rich interactions + materialize. MSG-007 splits for one-PR / one-review cadence:

- **W3-B1「画布底座」** = W3-03 + W3-04 + W3-06 (canvas shell + pure domain graph + autosave/lock)
- **W3-B2「节点与物化」** = W3-05 + W3-07 + W3-08 (after B1 merges)

#### W3-B2 pre-notes (do not implement in B1)

- Zod **node config schemas** live in `@studio/contracts` (W3-05).
- **Materialize (W3-08)** must consume W3-A `canvasPayload` **without changing its shape**.
- App-level validate `referencedAssetVersionIds` (JSONB, no FK) at materialize time.
- Cleaned `void gate` residue in `ShotPlanRepository.saveNewRevision` during B1 (MSG-005 observation).

### W3-B1 — Canvas foundation (MSG-007)

**Branch:** `feature/w3b1-canvas-foundation` (from main `62d6bcfa21b1013cc96a41c0e48de17297bbf6d4`)  
**Acceptance unit (one PR, one independent review):** W3-03 + W3-04 + W3-06

- `@xyflow/react` Studio three-pane layout (do **not** copy Eximia branding/UI)
- Node registry / typed ports / edge validation / cycle detection as **pure domain** in `packages/domain` (+ unit tests: self-loop, cross-layer back-edge/cycle, port mismatch, duplicate edges)
- Draft autosave (500ms), optimistic `ifRevision` lock, revision snapshot; concurrent conflict → **409 WORKFLOW_REVISION_CONFLICT** (conditional update + affected row count; never silent overwrite)
- Milestone: create empty workflow + save; illegal edges blocked immediately; cyclic graphs cannot be saved; refresh keeps positions/config/edges/revision; concurrent edits show conflict

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W3-03 | Studio / `@xyflow/react` layout | DONE | Three-pane Studio at `/projects/[projectId]/studio`; palette stubs (no Eximia); narrow &lt;1280 warning; Fake only. |
| W3-04 | Nodes/ports/cycle detection | DONE | `packages/domain/src/workflow-graph.ts` registry + `validateEdge` / `validateWorkflowGraph` / `detectCycles`; unit tests cover self-loop, cross-layer back-edge, port mismatch, duplicate edges, cycles. UI calls domain only. |
| W3-05 | 11 node config schemas | DONE | **W3-B2** — Zod in `@studio/contracts` `node-configs.ts` for 11 palette + system `approval_selector`; properties panel shells; PATCH normalizes configs. Fake only. |
| W3-06 | Autosave / revision | DONE | Prisma `workflows` / `workflow_drafts` / `workflow_revisions` + migration `20260912020000_w3b1_workflows`; PATCH `ifRevision` → 409 `WORKFLOW_REVISION_CONFLICT`; snapshot API; integration + e2e conflict tests. |
| W3-07 | Canvas interactions | DONE | **W3-B2** — undo/redo, copy/paste, delete-with-impact hint, Fit view; `isValidConnection` drag preview; domain `validateEdge` remains source of truth. |
| W3-08 | Plan → canvas materialize | DONE | **W3-B2** — `POST .../shot-plans/materialize`; domain `materializeShotPlanToGraph` from W3-A `canvasPayload` (shape unchanged); app-layer `assertVersionsInProject` for `referencedAssetVersionIds` (MSG-005); WRITE roles; Fake only. |

### W3-B1 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260912020000_w3b1_workflows` |
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm test:e2e` | Extends chain with workflow create→save→409 conflict→cycle reject→snapshot |
| Provider | **Fake only** (W0-02 BLOCKED_EXTERNAL); no real keys |
| Out of scope | W3-B2 node schemas UI / rich interactions / materialize |

**DONE evidence package (W3-03 / W3-04 / W3-06):**
- Branch HEAD: `5bbf0543f6b6da40840b6faf6285132119be0be6`
- Milestone PR (open, **not merged**): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/9
- CI green (pull_request): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34664994013
- Local e2e: create empty workflow → save positions → 409 conflict → cycle reject → refresh keeps graph → snapshot (Fake only)
- Implementer marks **DONE** only — **VERIFIED** requires 审稿 public APPROVED on PR #9 before merge

### W3-B2 — Nodes + materialize (MSG-007 / MSG-011)

**Branch:** `feature/w3b2-nodes-materialize` (from main `b22b966880c4948420e1f3b5b67ac5e4cbfa6546`)  
**Acceptance unit (one PR, one independent review):** W3-05 + W3-07 + W3-08

- Zod node config schemas for 11 MVP palette types (+ system `approval_selector`)
- Canvas interactions: undo/redo, copy/paste, delete impact hint, fit view, `isValidConnection`
- One-click materialize approved Shot Plan → 7-image workflow graph; validate `referencedAssetVersionIds`

### W3-B2 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm openapi:generate` | Includes materialize path |
| `pnpm test:e2e` | Extends chain with materialize (7 generate nodes) + prior B1 checks |
| Provider | **Fake only** (W0-02 BLOCKED_EXTERNAL); no real keys / no W4-07 |
| Out of scope | Real Provider execution; W4-01…06 (next after merge + 审稿 APPROVED per MSG-011) |

**DONE evidence package (W3-05 / W3-07 / W3-08):**
- Branch HEAD: `927b8247756ab1a3d3eab1d55bbff589f0640a36`
- Milestone PR (open, **not merged**): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/10
- CI green (push): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34666303115
- Local + CI: schemas validate; materialize → 7 generate nodes; illegal edges still blocked; Fake only
- Implementer marks **DONE** only — **VERIFIED** requires 审稿 public APPROVED on PR #10 before squash merge
- B2 complete pending 审稿

---

## W4 — Runtime: Model Registry / Run / Credits / Webhook / SSE

**Branch:** `feature/w4-runtime` (from main merge SHA `f54ed4a1d80a7ec4d0927e1713d4c5dcc7a9f437` — W3-B2)  
**Acceptance unit (one PR, one independent review):** W4-01…W4-06 (W4-07 stays BLOCKED_EXTERNAL)

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W4-01 | Model Registry + Fake ImageProviderAdapter (§9) | VERIFIED | `packages/domain` registry; `FakeImageProviderAdapter` in `@studio/providers` matching §9.1; `GET .../model-registry`; Fake only. |
| W4-02 | Run/Attempt state machine, Outbox, BullMQ Worker | VERIFIED | Prisma `generation_*` + `provider_submissions`; `OutboxRepository` + stable `gen-attempt-{id}` jobId; worker queue `generation-attempt` + recovery relay; reuse W2 outbox patterns. |
| W4-03 | Cost estimate, budget gate, Credit reserve/settle | VERIFIED | Append-only `credit_ledger_events` + controlled snapshot on `credit_accounts`; billing order estimate→budget→txn Run+Attempt+reserve+Outbox→dispatch→settle/refund; `BUDGET_EXCEEDED` / `INSUFFICIENT_CREDITS`. |
| W4-04 | Webhook verify, poll, idempotent event id, late results | VERIFIED | `POST /api/v1/providers/{providerKey}/webhook` raw-body HMAC; `provider_events` unique (provider, external_event_id); unknown job → 202 warning; late-after-cancel disposition. |
| W4-05 | SSE progress + task drawer | VERIFIED | `GET .../events?projectId=` SSE; Studio task drawer (run/cancel/retry + SSE); list runs API. |
| W4-06 | Fake Provider full failure matrix | VERIFIED | AUTH/VALIDATION/POLICY/QUOTA no auto-retry; RATE_LIMIT/TRANSIENT backoff; TIMEOUT max 2; UNKNOWN once; unit tests in `fake-adapter.test.ts` + domain retry policy tests. |
| W4-07 | Staging real generate/edit smoke | BLOCKED_EXTERNAL | **所有者裁决：推迟至开发全部完成后决定（密钥选型 + 素材收集）**。见 ADR-0003。Fake only until Phase 2. |

### W4 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260912030000_w4_runtime` |
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm openapi:generate` | Includes model-registry / runs / cancel / retry / events / webhook |
| `pnpm test:e2e` | Extends chain with registry→run→settle→budget gate→AUTH final→webhook idempotency→SSE (`GENERATION_INLINE=1`) |
| Provider | **FakeImageProviderAdapter only**; no real keys |
| Out of scope | W4-07 real Staging smoke; W5 node executors |

**VERIFIED evidence package (W4-01…W4-06):**
- Base merge: `f54ed4a1d80a7ec4d0927e1713d4c5dcc7a9f437` (W3-B2)
- Final HEAD before merge: `61165fc8a60889cb67f0cf51f2a6957f512af910`
- Milestone PR squash-merged: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/11 → main `16d67b3e664af05769b29b1149f6593c55e3197b`
- CI (final): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34682366351
- 审稿：REQUEST CHANGES → 快速复核 **APPROVED**；公开存档 https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/11#issuecomment-5644680296
- W4-07 remains **BLOCKED_EXTERNAL** (ADR-0003)

---

## Owner ruling — external deps deferred (2026-09-12)

See **ADR-0003** (`docs/adr/0003-fake-provider-acceptance.md`) and Kimi MSG-016 on issue #7:
- W0-02 / W2-07 / W4-07 stay BLOCKED_EXTERNAL until after full development.
- W5 accepts Fake success+failure matrix (W4-06) in place of §19.5 real Provider success cases (那些验收项挂起).
- W6 acceptance is two-phase (synthetic+Fake now; real smoke later as new CRs).

---

## W5 split (Kimi MSG-016)

- **W5-A**「执行器底座」= W5-01 + W5-08 + W5-02 (+ Webhook early-arrival reconcile)
- **W5-B**「蒙版与局部编辑」= W5-03 + W5-04 + W5-05
- **W5-C**「画幅与输出」= W5-06 + W5-07  
One branch / one PR / one review each; merge unlocks the next segment.

---

## W5-A — Executors foundation (VERIFIED)

**Branch:** `feature/w5a-executors` (from main `16d67b3`)  
**Acceptance unit:** W5-01 + W5-08 + W5-02 (+ webhook early-arrival orphan reconcile per 审稿)

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W5-01 | `generate` node executor | VERIFIED | Request snapshot per node type/ports; Fake GENERATE through W4 Run/Attempt/Worker; ingest GENERATED AssetVersion on success; NodeResult SUCCEEDED + fingerprint. |
| W5-08 | Input fingerprint + downstream STALE | VERIFIED | Domain RFC 8785 JCS → SHA-256 (`input-fingerprint.ts`); STALE BFS §32.2; `node_results` + disposition STALE; graph snapshot + Truth approve propagate; no silent reuse of STALE (reuse requires SUCCEEDED+matching fingerprint). |
| W5-02 | `remove_background` + full-res mask | VERIFIED | Fake REMOVE_BACKGROUND returns image+mask roles; MASK AssetVersion + Mask row; full request WxH recorded on version. |
| (ride) | Webhook early-arrival reconcile | VERIFIED | Orphan events `processedAt=null`; replay stays 202; reconcile when submission appears; `processedAt` only after apply. |

### W5-A commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260912040000_w5a_node_results` |
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm test:e2e` | Extends with remove_background+generate Fake success + orphan webhook semantics (`GENERATION_INLINE=1`) |
| Provider | **FakeImageProviderAdapter only** (ADR-0003); no real keys |
| Out of scope | W5-B/C; W4-07 / W0-02 / W2-07 |

§19.5 real-Provider success cases: **挂起** (ADR-0003). Fake matrix required.

**VERIFIED evidence package (W5-A):**
- Merge SHA: `f00c1deb589a9bc2951902400ff22c8e1011c99a` (PR #12 squash into main)
- Final HEAD before merge: `6342b1e7d31ace638c8069887d5744797ef58435`
- CI green (pull_request): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34683690044
- 审稿 **APPROVED** + public comment: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/12#issuecomment-5645637350
- Migration: `20260912040000_w5a_node_results`
- Fake only (ADR-0003); §19.5 real-Provider success cases remain 挂起

---

## W5-B — Mask editor + replace_background + inpaint (VERIFIED)

**Branch:** `feature/w5b-mask-edit` (from main `f00c1de` = W5-A)  
**Acceptance unit:** W5-03 + W5-04 + W5-05

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W5-03 | Mask editor UI | VERIFIED | Canvas brush/erase/size/zoom/undo/preview (`MaskEditor`); strokes as normalized `[0,1]×[0,1]` (§10.4); `POST .../masks/:id/render` → full-res grayscale PNG (white=edit, black=lock) matching source Asset Version WxH; persist via `masks` (`strokes_json`, `coordinate_space`, metadata). Domain golden + imaging raster tests (AC-07). |
| W5-04 | `replace_background` executor | VERIFIED | IMAGE+MASK+PROMPT+PRODUCT_TRUTH → IMAGE_LIST; `fidelity` / `lightBlend` (+ optional `maskId`); Fake `EDIT` product-lock stamp; fingerprint includes mask refs; ingest via W5-A path. |
| W5-05 | `inpaint` executor | VERIFIED | IMAGE+MASK+PROMPT (+ optional IMAGE_LIST) → IMAGE_LIST; `strength` + `modelKey`; Fake `INPAINT` path. |

### W5-B commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm openapi:generate` | Mask CRUD + render paths |
| `pnpm test:e2e` | Extends with mask create/render + replace_background + inpaint Fake (`GENERATION_INLINE=1`) |
| Provider | **FakeImageProviderAdapter only** (ADR-0003); no real keys |
| Out of scope | W5-C (06/07); W4-07 / W0-02 / W2-07 |

§19.5 real-Provider success cases: **挂起** (ADR-0003). Fake matrix required.

**VERIFIED evidence package (W5-B):**
- Merge SHA: `66944c384e4ec96cbbada1a66644576e214bb54a` (PR #14 squash into main)
- Final HEAD before merge: `31a88884557f4e782dc2de0fd93c1c4d21ee1c2c`
- CI green (pull_request): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34692005885
- 审稿 **APPROVED** + public comment: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/14#issuecomment-5645708346
- Fake only (ADR-0003); §19.5 real-Provider success cases remain 挂起

---

## W5-C — Outpaint + upscale / output normalize (DONE — awaiting 审稿)

**Branch:** `feature/w5c-outpaint-upscale` (from main `66944c3` = W5-B)  
**Acceptance unit:** W5-06 + W5-07

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W5-06 | `outpaint` executor | DONE | IMAGE + optional PROMPT → IMAGE_LIST; `targetRatio` / `placement` / `modelKey`; domain `computeOutpaintCanvas` (frame expand + original position); Fake `OUTPAINT`; request snapshot + fingerprint via W4/W5-A Run/Attempt/STALE path. |
| W5-07 | `upscale` + output normalize | DONE | IMAGE → IMAGE; `engineKey` (`default-upscale`) / `targetResolution`; Fake `UPSCALE`; long-edge tier dims; ingest PNG normalize (`normalizeProviderImageOutput`) to request WxH. |

### W5-C commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm openapi:generate` | Description bump W5-C |
| `pnpm test:e2e` | Extends with outpaint + upscale Fake (`GENERATION_INLINE=1`) |
| Provider | **FakeImageProviderAdapter only** (ADR-0003); no real keys |
| Out of scope | W6; W4-07 / W0-02 / W2-07; real Provider keys |

§19.5 real-Provider success cases: **挂起** (ADR-0003). Fake matrix required.

**DONE evidence package (W5-C):**
- Branch HEAD: `e5c9902bae93e5c33d1e824b7b10a78fb6647c06`
- Milestone PR (open, **not merged**): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/15
- Base: `66944c384e4ec96cbbada1a66644576e214bb54a` (W5-B)
- Local: domain canvas/placement; Fake OUTPAINT/UPSCALE; normalize unit tests; e2e outpaint+upscale SUCCEEDED (`GENERATION_INLINE=1`)
- Implementer marks **DONE** only — **VERIFIED** requires 审稿 public APPROVED before merge.

