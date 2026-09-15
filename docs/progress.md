# Progress ledger — Amazon AI Image Studio

> Synced from spec §24. Status legend: `TODO` → `IN_PROGRESS` → `DONE` → `VERIFIED` | `BLOCKED` | `BLOCKED_EXTERNAL`.
> **VERIFIED requires an independent reviewer or a fresh AI context** that re-ran acceptance checks.
> Implementing agents mark at most `DONE` with evidence — never self-`VERIFIED`.

**Repo type (W0-01):** GREENFIELD — empty public GitHub repo; no prior application code.

**Timezone note:** W2 milestone work 2026-09-11 Asia/Shanghai (UTC+8). W3-A / W3-B1 / W3-B2 / W4 / W5-A / W5-B / W5-C / W6 / W7 / W8 / W9 work 2026-09-12 Asia/Shanghai (UTC+8).

---

## Review policy (documented W2; **amended V2 2026-09-14**)

See `AGENTS.md` and `docs/architecture.md`: same-week related work → one milestone PR; continuous commits OK; DONE by implementer; W2 acceptance = full upload→Truth Pack chain. W3 is split into W3-A / W3-B1 / W3-B2; W5 into W5-A / W5-B / W5-C (Kimi MSG-016); W6 Phase 1 is one milestone PR (W6-01…08). W8 is one milestone PR (W8-01…07). W9 is docs-only buffer + release (no new product modules). Each is one independent review.

**V2 amendment (owner ruling 2026-09-14):** 外部审稿 bot（grok）额度用尽停用。VERIFIED 改由 **全新上下文 AI 复审**（新会话、与实现无共享上下文、重跑验收检查 + PR 留言）授予；**合并由所有者执行或明确指示**；高风险项需所有者明确点头。历史 VERIFIED（≤ PR #19 审稿 APPROVED）不受影响。V2 愿景与路线见 `docs/specs/v2-vision.md`。

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
| W2-07 | Fixture baseline (10 real SKUs) | BLOCKED_EXTERNAL | Only **3 synthetic SKUs** in `fixtures/eval-products/`. **MSG-035：产品为所有者自用（非公开发布）；不要求正式评测/UAT，验收=所有者真实试用。** ≥10 真实 SKU / §18.4 正式基线仅在转为多人/公司正式使用时重启（ADR-0003）。P2-A kie 接入不依赖本行 VERIFIED。 |

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

**VERIFIED backlog (Kimi MSG-016 observation ②):** W3-A / W3-B1 / W3-B2 were merged with 审稿 public APPROVED but the ledger stayed DONE. Ratified here after W5-A landed on main. W4-01…06 and W5-A are left as they stand on main.

**Why split:** Spec §19.3 packs Shot Plan (domain/API) and full Studio canvas (xyflow + 11 nodes + autosave + materialize) into one week. For one-PR / one-review cadence, that is too large and mixes high-risk graph UX with plan CRUD. Split into two independently reviewable milestones.

### W3-A — Shot Plan + plan approve (VERIFIED)

**Branch:** `feature/w3a-shot-plan`  
**Acceptance unit (one PR, one independent review):** W3-01 + W3-02

- Shot Plan / Shot Brief + default 7-image template
- AI plan draft (Fake planner while W0-02 blocked) + human approve gate
- Gate: from approved Truth Pack → editable plan → approve; tenant-scoped; tests + CI green

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W3-01 | Shot Plan/Brief + 7-image template | VERIFIED | Domain `shot-plan.ts` §11.1 default 7 (no PACKAGE); Prisma `shot_plan_*` + `shot_briefs`; tenant UUIDv7; revision **FK `truth_revision_id` → approved Truth revision**; contracts + `canvasPayload` for W3-08; migration `20260912010000_w3a_shot_plan`. Fake only. Independent review APPROVED on PR #8; merged to main as `62d6bcfa21b1013cc96a41c0e48de17297bbf6d4`. |
| W3-02 | Plan generate + approve | VERIFIED | `POST .../shot-plans/generate` (FakeShotPlanProvider); PUT human edit; **atomic approve** (W2 Truth structure: FOR UPDATE + PENDING_REVIEW + row counts + audit_events); roles WRITE OWNER/ADMIN/MEMBER, APPROVE OWNER/ADMIN/REVIEWER; cannot generate/approve without approved Truth; unit + integration + e2e; no W3-B (no xyflow/canvas/materialize). Independent review APPROVED on PR #8; merged to main as `62d6bcfa21b1013cc96a41c0e48de17297bbf6d4`. |

### W3-A commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260912010000_w3a_shot_plan` |
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm test:e2e` | Extends W2 chain with generate→edit→approve Shot Plan (`INSPECT_INLINE=1`) |
| Provider | **FakeShotPlanProvider only** (W0-02 BLOCKED_EXTERNAL); no real keys |
| Out of scope | W3-B canvas / xyflow / autosave / materialize / node registry |

**VERIFIED evidence package (W3-01…W3-02):**
- Final HEAD before merge: `9c2b2ce05a93b737add59ff3c384abb693d85fc4`
- Milestone PR squash-merged: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/8 → main `62d6bcfa21b1013cc96a41c0e48de17297bbf6d4`
- CI (review): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34662917739
- Main CI green: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34664089676
- 审稿 **APPROVED** 公开存档：https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/8#issuecomment-5642405979
- Local e2e: W2 Truth approve → Fake generate 7 briefs → PUT edit → Shot Plan approve
- MSG-016 observation ② backlog ratification (docs-only; W5-A already on main)

### W3-B split (MSG-007)

**Why further split B:** Spec §19.3 still packs xyflow layout + graph engine + autosave + 11 node schemas + rich interactions + materialize. MSG-007 splits for one-PR / one-review cadence:

- **W3-B1「画布底座」** = W3-03 + W3-04 + W3-06 (canvas shell + pure domain graph + autosave/lock)
- **W3-B2「节点与物化」** = W3-05 + W3-07 + W3-08 (after B1 merges)

#### W3-B2 pre-notes (do not implement in B1)

- Zod **node config schemas** live in `@studio/contracts` (W3-05).
- **Materialize (W3-08)** must consume W3-A `canvasPayload` **without changing its shape**.
- App-level validate `referencedAssetVersionIds` (JSONB, no FK) at materialize time.
- Cleaned `void gate` residue in `ShotPlanRepository.saveNewRevision` during B1 (MSG-005 observation).

### W3-B1 — Canvas foundation (VERIFIED)

**Branch:** `feature/w3b1-canvas-foundation` (from main `62d6bcfa21b1013cc96a41c0e48de17297bbf6d4`)  
**Acceptance unit (one PR, one independent review):** W3-03 + W3-04 + W3-06

- `@xyflow/react` Studio three-pane layout (do **not** copy Eximia branding/UI)
- Node registry / typed ports / edge validation / cycle detection as **pure domain** in `packages/domain` (+ unit tests: self-loop, cross-layer back-edge/cycle, port mismatch, duplicate edges)
- Draft autosave (500ms), optimistic `ifRevision` lock, revision snapshot; concurrent conflict → **409 WORKFLOW_REVISION_CONFLICT** (conditional update + affected row count; never silent overwrite)
- Milestone: create empty workflow + save; illegal edges blocked immediately; cyclic graphs cannot be saved; refresh keeps positions/config/edges/revision; concurrent edits show conflict

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W3-03 | Studio / `@xyflow/react` layout | VERIFIED | Three-pane Studio at `/projects/[projectId]/studio`; palette stubs (no Eximia); narrow &lt;1280 warning; Fake only. Independent review APPROVED on PR #9; merged to main as `b22b966880c4948420e1f3b5b67ac5e4cbfa6546`. |
| W3-04 | Nodes/ports/cycle detection | VERIFIED | `packages/domain/src/workflow-graph.ts` registry + `validateEdge` / `validateWorkflowGraph` / `detectCycles`; unit tests cover self-loop, cross-layer back-edge, port mismatch, duplicate edges, cycles. UI calls domain only. Independent review APPROVED on PR #9; merged to main as `b22b966880c4948420e1f3b5b67ac5e4cbfa6546`. |
| W3-05 | 11 node config schemas | VERIFIED | **W3-B2** — Zod in `@studio/contracts` `node-configs.ts` for 11 palette + system `approval_selector`; properties panel shells; PATCH normalizes configs. Fake only. Independent review APPROVED on PR #10; merged to main as `f54ed4a1d80a7ec4d0927e1713d4c5dcc7a9f437`. |
| W3-06 | Autosave / revision | VERIFIED | Prisma `workflows` / `workflow_drafts` / `workflow_revisions` + migration `20260912020000_w3b1_workflows`; PATCH `ifRevision` → 409 `WORKFLOW_REVISION_CONFLICT`; snapshot API; integration + e2e conflict tests. Independent review APPROVED on PR #9; merged to main as `b22b966880c4948420e1f3b5b67ac5e4cbfa6546`. |
| W3-07 | Canvas interactions | VERIFIED | **W3-B2** — undo/redo, copy/paste, delete-with-impact hint, Fit view; `isValidConnection` drag preview; domain `validateEdge` remains source of truth. Independent review APPROVED on PR #10; merged to main as `f54ed4a1d80a7ec4d0927e1713d4c5dcc7a9f437`. |
| W3-08 | Plan → canvas materialize | VERIFIED | **W3-B2** — `POST .../shot-plans/materialize`; domain `materializeShotPlanToGraph` from W3-A `canvasPayload` (shape unchanged); app-layer `assertVersionsInProject` for `referencedAssetVersionIds` (MSG-005); WRITE roles; Fake only. Independent review APPROVED on PR #10; merged to main as `f54ed4a1d80a7ec4d0927e1713d4c5dcc7a9f437`. |

### W3-B1 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260912020000_w3b1_workflows` |
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm test:e2e` | Extends chain with workflow create→save→409 conflict→cycle reject→snapshot |
| Provider | **Fake only** (W0-02 BLOCKED_EXTERNAL); no real keys |
| Out of scope | W3-B2 node schemas UI / rich interactions / materialize |

**VERIFIED evidence package (W3-03 / W3-04 / W3-06):**
- Final HEAD before merge: `57d02ee04ad71a22c9a8c3441c93936184fb4b5a`
- Milestone PR squash-merged: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/9 → main `b22b966880c4948420e1f3b5b67ac5e4cbfa6546`
- CI (review): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34665142469
- Main CI green: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34665541978
- 审稿 **APPROVED**：https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/9#issuecomment-5642601639
- Local e2e: create empty workflow → save positions → 409 conflict → cycle reject → refresh keeps graph → snapshot (Fake only)
- MSG-016 observation ② backlog ratification (docs-only; W5-A already on main)

### W3-B2 — Nodes + materialize (VERIFIED)

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

**VERIFIED evidence package (W3-05 / W3-07 / W3-08):**
- Final HEAD before merge: `ebf4f122185f7c4ef0cd90cec8870b6fd5e0aff8`
- Milestone PR squash-merged: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/10 → main `f54ed4a1d80a7ec4d0927e1713d4c5dcc7a9f437`
- CI (review): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34666415372
- Main CI green: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34671461782
- 审稿 **APPROVED** 公开存档：https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/10#issuecomment-5643273127
- Local + CI: schemas validate; materialize → 7 generate nodes; illegal edges still blocked; Fake only
- MSG-016 observation ② backlog ratification (docs-only; W5-A already on main)

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
| W4-07 | Staging real generate/edit smoke | BLOCKED_EXTERNAL | **MSG-035：自用场景不要求正式 Staging UAT。** 所有者本机真实 smoke（kie key 到位后）即可；正式 Staging smoke / 多人评测仅在产品转向多人/公司正式使用时恢复。见 ADR-0003 + P2-A。 |

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

## W5-C — Outpaint + upscale / output normalize (VERIFIED)

**Branch:** `feature/w5c-outpaint-upscale` (from main `66944c3` = W5-B)  
**Acceptance unit:** W5-06 + W5-07

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W5-06 | `outpaint` executor | VERIFIED | IMAGE + optional PROMPT → IMAGE_LIST; `targetRatio` / `placement` / `modelKey`; domain `computeOutpaintCanvas` (frame expand + original position); Fake `OUTPAINT`; request snapshot + fingerprint via W4/W5-A Run/Attempt/STALE path. |
| W5-07 | `upscale` + output normalize | VERIFIED | IMAGE → IMAGE; `engineKey` (`default-upscale`) / `targetResolution`; Fake `UPSCALE`; long-edge tier dims; ingest PNG normalize (`normalizeProviderImageOutput`) to request WxH. |

### W5-C commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm openapi:generate` | Description bump W5-C |
| `pnpm test:e2e` | Extends with outpaint + upscale Fake (`GENERATION_INLINE=1`) |
| Provider | **FakeImageProviderAdapter only** (ADR-0003); no real keys |
| Out of scope | W6; W4-07 / W0-02 / W2-07; real Provider keys |

§19.5 real-Provider success cases: **挂起** (ADR-0003). Fake matrix required.

**VERIFIED evidence package (W5-C):**
- Merge SHA: `7025b871692478f181cefe1da26507451786eb89` (PR #15 squash into main)
- Final HEAD before merge: `bf8ba8b261f66473a8a50c38a94da7d6f691c36d`
- CI green: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34692729746
- 审稿 **APPROVED** + public comment: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/15#issuecomment-5645793937
- Fake only (ADR-0003); §19.5 real-Provider success cases remain 挂起

---

## W6 — Amazon QA, Review, Export (Phase 1 / ADR-0003) (VERIFIED)

**Branch:** `feature/w6-qa-export` (from main `7025b87` = W5-C)  
**Acceptance unit (one PR, one independent review):** W6-01…W6-08  
**Phase 1 only:** 3 synthetic SKUs + Fake OCR/Vision prove QA mechanics. Real Provider / real SKU eval = Phase 2 hung (ADR-0003). No real keys.

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W6-01 | Market Rule Pack + `amazon-main-us-v1` | VERIFIED | Versioned JSON `docs/qa-rules/amazon-main-us-v1.json` + `docs/qa-rules/amazon-main-us-v1.md`; runtime pack in `@studio/domain`; merge algorithm (specificity/priority, CR required to lower severity / clear nonWaivable); `global_market_rule_definitions` + activations. |
| W6-02 | Size/format/background/ratio/border/blur | VERIFIED | Deterministic evaluators + `@studio/imaging` `analyzeQaPixels` (white complement minus 5px@2k halo, subject extent, edge margin, Laplacian blur, border band). |
| W6-03 | OCR vs confirmed facts | VERIFIED | `FakeOcrProvider` scenarios SUCCESS/OVERLAY_TEXT/FACT_MISMATCH/LOW_CONFIDENCE; `MAIN.NO_OVERLAY_TEXT` + `PRODUCT.FACT_TEXT_MATCH`. |
| W6-04 | Vision identity / defects | VERIFIED | `FakeVisionQaProvider` SUCCESS/IDENTITY_MISMATCH/UNSOLD_*; `PRODUCT.IDENTITY` + `MAIN.ONLY_SOLD_ITEMS`. |
| W6-05 | Findings + tri-state aggregation | VERIFIED | Finding schema + evidence regions `[0,1]`; overall PASS/REVIEW/BLOCK per §31.14; `FILE.DECODABLE` nonWaivable. |
| W6-06 | Review / approve / override | VERIFIED | `/projects/[id]/review` compare + evidence boxes; append-only APPROVE/REJECT/OVERRIDE_BLOCK/REVOKE; roles OWNER/ADMIN/REVIEWER approve, OWNER/ADMIN override; `qa_gate` PASS ≠ Approval. |
| W6-07 | Export Worker / manifest / CSV / ZIP | VERIFIED | Outbox `export-bundle-{id}`; fixed `manifest.json` + UTF-8 BOM `qa-report.csv`; STORE ZIP with bundle `createdAt`; MAIN BLOCK blocks default export; checksums. |
| W6-08 | New-project → ZIP E2E | VERIFIED | API-level full chain in `scripts/e2e-api.mjs` (Playwright not in repo — documented). PASS export ZIP; BLOCK blocks; OVERRIDE then ZIP; Fake OCR/Vision scenarios; tenant 403. |

### W6 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260912050000_w6_qa_export` |
| `pnpm lint` / `typecheck` / `test` / `build` | Local green 2026-09-12 Asia/Shanghai |
| `pnpm openapi:generate` | QA / approval / export paths (v0.4.0) |
| `pnpm test:e2e` | Extends with QA→approve→ZIP and MAIN BLOCK export gate (`INSPECT_INLINE` also inlines QA/export) |
| Provider | **Fake OCR + Fake Vision QA + Fake Image only** (ADR-0003); no real keys |
| Out of scope | W4-07 / W0-02 / W2-07; Phase 2 real smoke |

`qa_gate` PASS is never human Approval. Phase 2 real-Provider / real-SKU eval remains 挂起 (ADR-0003).

**VERIFIED evidence package (W6-01…W6-08):**
- Merge SHA: `15f49796939b4cef2a42df3e6bd1dab788ce308b` (PR #16 squash into main)
- Final HEAD before merge: `3f87414445e1b4c8a9562f2d6086e234aeb0361b`
- CI green (pull_request): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34694106828
- 审稿 **APPROVED** + public comment: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/16#issuecomment-5646158791
- Fake only (ADR-0003); Phase 2 real-Provider / real-SKU eval remains 挂起
- W7 unlocked after this VERIFIED ratification

---

## W7 — Variants / batch / QA / export / admin (VERIFIED)

**Branch:** `feature/w7-variants` (from main `15f49796939b4cef2a42df3e6bd1dab788ce308b` = W6)  
**Acceptance unit (one PR, one independent review):** W7-01…W7-07  
**Fake only** (ADR-0003). No real keys. W8 unlocked after this VERIFIED ratification.

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W7-01 | Variant entities, master selection, component color config | VERIFIED | Prisma `variants` / `variant_components` / `variant_items` (+ `variant_runs`); migration `20260912060000_w7_variants`; domain validate + APIs POST/GET/PATCH. |
| W7-02 | Batch-derive variant workflows from approved master | VERIFIED | `POST .../variants/{id}/materialize` clones master graph with color overrides (no Approval inherit); `POST .../variant-runs` Fake 3×7 batch. |
| W7-03 | Per-item status, partial retry, batch budget cap | VERIFIED | Item RESERVE/SETTLE/REFUND; `BUDGET_EXCEEDED` unless confirmBudget; single AUTH fail → PARTIAL; `POST .../variant-items/{id}/retry`. |
| W7-04 | Variant QA structure/logo/text/composition/attachment | VERIFIED | Fake Vision scenarios STRUCTURE_CHANGE/LOGO_CHANGE/COMPOSITION_DRIFT/ATTACHMENT_COUNT; maps to QA_BLOCK/REVIEW via W6 Fake QA path. |
| W7-05 | Filter failed; export only passing; variant manifest | VERIFIED | `POST .../variant-runs/{id}/export` filters non-PASS; manifest + filteredOut; requires per-item Approval (master Approval not inherited). |
| W7-06 | Admin Jobs + credit adjust + cost reconciliation | VERIFIED | `/admin` + APIs under `.../admin/{jobs,credits,reconciliation}`; OWNER/ADMIN only; ADJUST audited. |
| W7-07 | Ops notes + failure runbook | VERIFIED | `docs/runbooks/variant-batch.md`, `credit-reconciliation.md`, `provider-outage-stuck-jobs.md`. |

### W7 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260912060000_w7_variants` |
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm openapi:generate` | Variant / admin paths |
| `pnpm test:e2e` | Extends with 3×7 Fake batch, partial fail, ledger, structure/logo BLOCK, filtered export (`INSPECT_INLINE=1`) |
| Provider | **Fake only** (ADR-0003); no real keys |
| Out of scope | (at ship) W8; W4-07 / W0-02 / W2-07; real Provider keys — W8 now unlocked after VERIFIED |

**VERIFIED evidence package (W7-01…W7-07):**
- Merge SHA: `21bd2e7fb26ad7617975e570d98b1555dc9a6003` (PR #17 squash into main)
- Tip CI green (pull_request): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34697260457
- 审稿 **APPROVED** + public comment: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/17#issuecomment-5646415995
- Fake only (ADR-0003); OUT: W8 at merge time (now unlocked)
- W8 unlocked after this VERIFIED ratification

---

## W8 — Hardening / eval / security / Production candidate (Phase 1 Fake) (VERIFIED)

**Branch:** `feature/w8-hardening` (from main `21bd2e7fb26ad7617975e570d98b1555dc9a6003` = W7)  
**Acceptance unit (one PR, one independent review):** W8-01…W8-07  
**Fake only** (ADR-0003). No real keys. No Production deploy. W9 unlocked after this VERIFIED ratification (docs-only buffer + release).

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W8-01 | Expand visual eval set + baseline report | VERIFIED | Phase 1 uses **3 synthetic SKUs** (W2-07 10 real hung); `eval-briefs.json` + `golden-qa/`; `pnpm test:eval` → `docs/eval/w8-phase1-baseline-report.md` |
| W8-02 | Tune prompts/refs/QA thresholds vs Fake failures | VERIFIED | `prompt-templates.ts` + MAIN template locks; rule pack **v2** (extent 0.82 / overlay 0.92 / blur review 85); `docs/eval/w8-02-prompt-qa-tuning.md` |
| W8-03 | Concurrency / backpressure / 30-image stress | VERIFIED | Worker `concurrency` + admit-time `QUEUE_BACKPRESSURE`; `pnpm test:stress-30` → `docs/eval/w8-03-load-report.md`; domain tests |
| W8-04 | Security checklist tests | VERIFIED | Authz / signed URL / SSRF / webhook sig / log redaction automated + `docs/security/w8-04-checklist.md` |
| W8-05 | Backup/restore/rollback/user-delete drill | VERIFIED | `docs/runbooks/backup-restore-rollback.md`, `user-delete-drill.md`; stub `scripts/backup-restore-drill.sh` |
| W8-06 | A11y/empty/error/browser cheap fixes | VERIFIED | Review + Studio landmarks/live regions/empty+error; `docs/eval/w8-06-a11y-browser-notes.md` |
| W8-07 | Staging UAT + release + Prod candidate notes | VERIFIED | `docs/release/w8-07-*.md` — no real Production keys; §18.4 Fake exception documented |

### W8 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm test:eval` | Fake baseline report under `docs/eval/` |
| `pnpm test:stress-30` | 30-item Fake load report |
| Provider | **Fake only** (ADR-0003); no real keys |
| Out of scope | Real Provider Phase 2; Production go-live; real keys |

**VERIFIED evidence package (W8-01…W8-07):**
- Merge SHA: `c57e3163c266f4632a32c2f1a4f0941d2273c873` (PR #18 squash into main)
- Final HEAD before merge: `838e741928c9128eb3bffd84cea80fffebf79d4c`
- Tip CI green (pull_request): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34699179820
- 审稿 **APPROVED** + public comment: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/18#issuecomment-5646504447
- Fake only (ADR-0003); no Production deploy; no real keys
- W9 unlocked after this VERIFIED ratification (buffer + release docs only)

---

## W9 — Buffer + release (docs only; no new product modules) (W9-01 VERIFIED)

**Branch:** `docs/w9-buffer-release` (from main `c57e3163c266f4632a32c2f1a4f0941d2273c873` = W8)  
**Acceptance unit (one PR, one independent review):** W9-01 release-buffer docs. **W9-02 Production publish stays BLOCKED_EXTERNAL.**  
**Fake only** (ADR-0003). No real keys. No Production deploy. No new product modules (spec §19.9).

§19.9 allowed (docs only this week): Provider/docs inconsistency notes; visual-consistency backlog; perf/browser/security leftover list; UAT P0/P1 tracker; conditional second-provider note.  
§19.9 forbidden (not started): 3D, full Listing, translation center, collaboration, UI redesign, swapping DB / canvas / queue.

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W9-01 | 发布缓冲（issue closure / release docs） | VERIFIED | `docs/release/go-no-go.md`, `docs/release/backlog.md`, `docs/release/monitoring.md`. Allowed §19.9 notes are explicit Backlog rows — not hidden flags. Independent review APPROVED on PR #19; merged to main as `659d96037d89dc178f312f122cbf80ad5948da52`; tip CI green https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34699543761. Fake Phase 1 **CONDITIONAL GO** only — not Production. |
| W9-02 | Production 发布 | BLOCKED_EXTERNAL | **MSG-035：自用 ≠ 公开发布 Production。** 保持 **NO-GO** for public/company Production until §32.15 + formal eval recovery. Owner self-use with `IMAGE_PROVIDER=kie` is out of band of W9-02. **Production smoke was not run and is not claimed passed.** |

### W9-01 VERIFIED deliverables (not Production GO)

| Deliverable | Path | Status |
|---|---|---|
| Go / No-Go checklist | `docs/release/go-no-go.md` | VERIFIED — **CONDITIONAL GO** for Fake / Phase 1 only; **NO-GO** real Production |
| Hung deps + leftover backlog | `docs/release/backlog.md` | VERIFIED — external deps, W8 non-blockers, visual/perf/security leftovers, UAT P0/P1 tracker, second-provider note |
| Monitoring / alert ownership | `docs/release/monitoring.md` | VERIFIED — placeholders; **owner must fill** before any Production GO |
| Architecture / AGENTS brief | `docs/architecture.md`, `AGENTS.md` | VERIFIED — W8 VERIFIED + W9 buffer pointer |

### W9 commands / evidence (implementer)

| Command | Result |
|---|---|
| Scope | Docs only. No new product modules. No real keys. |
| `pnpm lint` / `typecheck` / `test` / `build` | Unchanged product code; CI on PR-to-main still required |
| Provider | **Fake only** (ADR-0003) |
| Out of scope | Real Production smoke; W9-02 GO; second Provider adapter; 3D / Listing / translation / collab / UI redesign / stack swap |

**VERIFIED evidence package (W9-01 only):**
- Merge SHA: `659d96037d89dc178f312f122cbf80ad5948da52` (PR #19 squash into main)
- Final HEAD before merge: `52bf613e6b9c4b8bec0c5edfa2a8b521a250c042`
- Tip CI green (pull_request): https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34699543761
- 审稿 **APPROVED** + public archive: https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/19#issuecomment-5646543987
- Fake only (ADR-0003); no Production deploy; no real keys
- W9-02 remains **BLOCKED_EXTERNAL** / Production **NO-GO** — Production smoke not run; until W0-02 / W2-07 / W4-07 + Phase 2 + signed §32.15

---

## P2-A — kie.ai plug-and-play image gateway (DONE)

**Branch:** `feature/p2a-kie-gateway` (from latest `main`)  
**Acceptance unit (one PR, one independent review):** sole Phase 2 milestone (MSG-035 / MSG-036). **Do not merge without 审稿 public APPROVED.**  
**Provider:** kie.ai third-party API gateway (`IMAGE_PROVIDER=kie`). Secrets never in repo.  
**Product mode:** owner **self-use** — acceptance = owner real trial (no formal eval/UAT gate).

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| P2-A-01 | `KieImageProviderAdapter` (createTask / recordInfo / webhook / credits) | DONE | `packages/providers/src/kie-adapter.ts`; Bearer auth; env base URL + model IDs + key; mocked HTTP contract tests |
| P2-A-02 | Immediate MinIO persist of gateway media | DONE | `getStatus` downloads allowlisted result URLs → `bytesBase64`; existing `ingestProviderOutputs` → MinIO (14-day gateway retention) |
| P2-A-03 | Rate limit awareness (~20 creates / 10s) | DONE | In-process `CreateRateLimiter` + `KIE_WORKER_CONCURRENCY_CAP`; 429 → `RATE_LIMIT` retry matrix |
| P2-A-04 | Retry / failure matrix on real path (W4-06 style) | DONE | AUTH/VALIDATION/POLICY/QUOTA no auto-retry; RATE_LIMIT/TRANSIENT/TIMEOUT/UNKNOWN via `normalizeError` + existing worker `shouldAutoRetry` |
| P2-A-05 | `.env.example` placeholders + self-serve runbook | DONE | `.env.example`; `docs/runbooks/self-serve-setup.md` |
| P2-A-06 | Ledger + ADR recovery (MSG-035) | DONE | W2-07 / W4-07 / W9-02 notes; ADR-0003 formal-eval recovery only if multi-user/company formal use; ADR-0001 kie amendment |

### P2-A commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR (CI must pass **without** real keys) |
| Provider select | `IMAGE_PROVIDER=kie` + `KIE_API_KEY` → `createImageAdapter()` returns `KieImageProviderAdapter` |
| Credits path | Documented `GET /api/v1/chat/credit` (not invented `/user/credits`) |
| Out of scope | Merging without 审稿; committing real keys; claiming §18.4 / W9-02 Production GO |

**Status:** **DONE** (not VERIFIED). VERIFIED only after independent 审稿 APPROVED on the PR.

---

## V2-A — Planner Agent：kie LLM 规划 + 意图向导 + 自动门禁开关 (DONE)

**Branch:** `feat/v2-planner-agent` (from main `b4d247e`)  
**Acceptance unit (one PR, one review per V2 amended policy):** V2-A-01…V2-A-06. 合并由所有者执行（见 V2 review policy）。  
**Background:** Owner vision (2026-09-14): 流程化（向导）+ 自由画布并存，Agent 先规划卖点/场景。单 KIE_API_KEY 同时驱动生图与规划 LLM。⚠️ kie LLM 端点实为**路径含模型 slug** `POST {base}/{model}/v1/chat/completions`（统一 `/api/v1/chat/completions` 对 LLM 返回 "feature not supported"；详见 `docs/specs/v2-vision.md` §5）。  
**Scope note:** PR-3 of the agreed V2 sequence (UI 重构 / 画布命令层 暂未做)。Fake 仍为默认；真实 LLM 规划走 `PLANNER_PROVIDER=kie`。

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| V2-A-01 | Pluggable planner port + `intent` field | DONE | `ShotPlanDraftRequest.intent`; factory `createShotPlanProvider()` (`PLANNER_PROVIDER=fake\|kie`) |
| V2-A-02 | `OpenAiCompatShotPlanProvider` (kie chat completions) | DONE | `packages/providers/src/openai-compat-planner.ts`; Bearer KIE_API_KEY; `response_format: json_object`; Zod-validated; **template skeleton (slot/order/ratio/pixels/qaPolicy) always wins over LLM output**; error classes AUTH/VALIDATION/RATE_LIMIT/TRANSIENT/TIMEOUT/UNKNOWN |
| V2-A-03 | Fake planner intent weaving | DONE | Intent segments → FEATURE copy (source `intent`), LIFESTYLE scene flavor; deterministic; offline default unchanged |
| V2-A-04 | Generate route: intent + provider factory + planner error mapping | DONE | `PLANNER_AUTH_FAILED`/`PLANNER_UNAVAILABLE` 502/503; audit unchanged (`shot_plan.generated`) |
| V2-A-05 | Workspace `autoApproveGates` switch + inline auto-approve | DONE | Prisma `workspaces.auto_approve_gates` (migration `20260914010000_v2_auto_approve_gates`); PATCH `/api/workspaces/{id}` OWNER/ADMIN + `workspace.auto_approve_gates_changed` audit; generate with `autoApprove:true` → inline `approveRevision` (audit actor = requester); `/api/me` exposes flag |
| V2-A-06 | Intent wizard UI | DONE | `/projects/[projectId]/wizard` — 3-step: 意图 → AI 计划（卖点/场景简报）→ 批准/物化 → Studio；admin 开关 toggle；项目页入口 |

### V2-A commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:generate` / `openapi:generate` | Client regenerated; `docs/api/openapi.yaml` updated (intent/autoApprove) |
| `pnpm lint` / `typecheck` / `test` / `build` | Local green 2026-09-14 Asia/Shanghai (49/49 providers tests incl. 16 planner tests) |
| `pnpm test:e2e` | **PASS locally 2026-09-14** (web on :3100, `INSPECT_INLINE=1 GENERATION_INLINE=1`) — full W2…W7 chain incl. variants batch/QA/export/admin; V2-A changes non-breaking |
| `pnpm db:migrate` | Applied locally — 11 migrations up to date |
| Real kie planner smoke | **PASS 2026-09-14** — `gemini-3-flash`, 18.8s, 7 briefs honoring intent (18h 保温/450ml/办公/车载) + confirmed facts only; endpoint fix commit `b0d4cb1` (model slug in path + kie 200-envelope error mapping) |
| Provider | **Fake default**; kie planner only with `PLANNER_PROVIDER=kie` + local `KIE_API_KEY`; no keys in repo |
| Migration | `20260914010000_v2_auto_approve_gates` (additive, default false — safe) |
| Out of scope | UI 设计系统重构（V2 PR-1）；画布命令层 / 自由画布（PR-2）；聊天 Agent 面板（PR-4） |

**Status:** **DONE** (not VERIFIED). VERIFIED per V2 amended policy: fresh-context review PASS + owner merge + main CI green.

---

## V2 PR-2 — 画布命令层 + 自由画布 (VERIFIED)

**Branch:** `feat/v2-canvas-commands` (from main `b4d247e`)
**Acceptance unit (one PR, one independent review):** V2 vision §3 PR-2 — canvas command layer (addNode / connect / configure / run / undo) + free canvas Studio UX. **Merging is performed by the owner** (V2 rule); implementer only opens the PR.

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| PR-2-01 | Command schema + domain `applyWorkflowCommands` | DONE | contracts `workflow-commands` schema + domain `applyWorkflowCommands` (commit `06fd1dc`); 27 domain unit tests + 7 contracts unit tests |
| PR-2-02 | `command_batches` table + WorkflowRepository apply/undo/redo | DONE | Pure-incremental migration `20260915010000_v2_canvas_command_batches`; `applyCommandBatch` / `undoCommandBatch` / `redoCommandBatch`; `WorkflowUndoError`; idempotent `batchId` (commit `16f3912`); 6 integration tests |
| PR-2-03 | Command API + `create-run` extraction | DONE | `POST .../commands`, `.../commands/undo`, `.../commands/redo` routes + `getCommandBatch`; shared `apps/web/lib/create-run.ts` keeps 402 / idempotency semantics (commit `ca49d7f`); 2 route-level integration tests |
| PR-2-04 | Studio on command API + dropdowns + per-node run + blank canvas | DONE | `use-workflow-commands.ts` serial promise chain + optimistic rollback + 500ms debounce merge (configure/moveNode); server undo/redo replaces frontend `historyRef`; config panel UUID free-text → dropdowns (assets / truth-pack / shot-plan briefs / masks linked / model-registry); per-node run button; TaskDrawer whole-canvas run → `run` command; project page「新建空白画布」+ studio `?workflowId=` (commit `88789ff`) |
| PR-2-05 | OpenAPI registration + e2e | DONE | commands / undo / redo paths + 4 schemas registered (masks list endpoint registered earlier); new V2 e2e segment (commit `901edb1`) |

### V2 PR-2 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm lint` / `typecheck` / `test` / `build` | Local green (exit 0), 2026-09-15 Asia/Shanghai |
| `RUN_INTEGRATION=1 pnpm --filter @studio/db test` | 35/35 (incl. 6 new) |
| apps/web route integration / unit | 2/2 integration; 7 unit passed |
| `pnpm db:migrate:deploy` | Includes `20260915010000_v2_canvas_command_batches` (pure incremental) |
| `pnpm test:e2e` (web :3100 + worker, `INSPECT_INLINE=1 GENERATION_INLINE=1`, `IMAGE_PROVIDER=fake` override) | PASS ~8s; V2 segment: batch apply / idempotent replay / illegal connect 400 / undo / redo / `WORKFLOW_UNDO_CONFLICT` / stale 409 / `run` command SUCCEEDED / 402 `BUDGET_EXCEEDED` with `commandsApplied:true` / masks list |
| Provider | **Fake only** (e2e explicit `IMAGE_PROVIDER=fake`); no real keys |
| Out of scope | UI redesign PR-1; chat Agent PR-4; real Provider; BRANCH_FROM all-branch traversal; whole-graph PATCH endpoint retained |

**Status:** **VERIFIED** — 符合 V2 规则 12d：fresh-context 复审 REVIEW PASS（PR #25 留言 <https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/pull/25#issuecomment-5673584150>）+ 所有者 squash 合并至 main（merge SHA `7a2a07d90083235222bd57e11cf7304f983b0bdb`）+ main CI 绿（run <https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34925284168>）。

---

## V2 PR-1 — UI 重构 (DONE)

**Branch:** `feat/v2-ui-overhaul` (stacked on `feat/v2-canvas-commands` / PR #25, 未合并)
**Acceptance unit (one PR, one independent review):** V2 vision §3 PR-1 — 样式体系、素材缩略图、审核页真实看图、步骤导航、登录态导航。**Merging is performed by the owner** (V2 rule); implementer only opens the PR.

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| PR-1-01 | 样式体系（方案 A 零依赖） | DONE | `app/globals.css` CSS 变量 tokens（抽出 #0b1020/#e8eefc/#1e2a44/#9db7ff/#121a2e/#2a3a5a 等全部魔法色）+ reset + 组件类；`components/ui.tsx` 原语 Button/Card/Input/Select/Badge/ErrorBanner/EmptyState/Spinner；逐页去内联化（layout/home/login/register/projects/项目详情/admin/review/studio stub + StudioCanvas/PropertiesPanel/MaskEditor），不改交互逻辑（commit `2c521a2`） |
| PR-1-02 | 登录态导航 | DONE | `components/site-header.tsx`（/api/me：email + workspace 名/角色徽标，OWNER/ADMIN 显示 Admin 入口，signOut 退出登录）替换 layout 内联 header；`lib/use-me.ts` 轻量缓存；全站裸 `<a>` → next/link（commit `34b3f7d`） |
| PR-1-03 | Workspace 上下文 | DONE | `lib/use-workspace.ts`：?workspaceId= 优先 → localStorage 记忆 → /api/me 首个 workspace；`projectHref()` 自动拼参；projects/项目详情/studio/review 接入，缺参不再裸报错（commit `be8a8d9`） |
| PR-1-04 | 步骤导航 | DONE | `components/project-stepper.tsx`（素材→Truth Pack→Shot Plan→画布→审核导出，当前高亮/完成打勾/可点击）；纯函数 `lib/project-step.ts deriveProjectStep()` + 10 个 vitest 单测；项目详情/studio/review 三页顶部（commit `a9c16c3`） |
| PR-1-05 | 素材缩略图 + 审核真图 | DONE | `lib/use-asset-image.ts`（download-url 签名 URL，900s 过期/800s 预刷新/按 versionId 缓存/卸载清理）+ `components/asset-image.tsx`（原生 img）；项目详情素材列表缩略图、PropertiesPanel source_image 选中预览、节点卡片小图；审核页 compare 面板垫 NORMALIZED_PNG 真图 + evidence 叠加保留 + 失败回退灰底（commit `139f43c`） |
| PR-1-06 | /projects Suspense 修复 | DONE | useWorkspace 经 useSearchParams，/projects 缺 Suspense 导致 build 预渲染失败 → 补边界（commit `4ee7cd2`） |

### V2 PR-1 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm lint` | Exit 0（apps/web 仍是 `next lint \|\| true` — 范围外发现） |
| `pnpm typecheck` | Exit 0（packages build + 全仓 tsc） |
| `pnpm test` | 全绿：web 17 passed（含新 project-step 10 个）/ 10 skipped（integration 需 RUN_INTEGRATION）；domain 151；contracts 24；providers 33；db 4 passed/31 skipped；imaging 9；config 7；storage 2；worker 1 |
| `pnpm build` | Exit 0（13 静态页生成；仅有 bullmq 可选依赖 @valkey/valkey-glide 预存警告） |
| `pnpm test:e2e`（web :3200 + worker，主仓 .env 注入，`IMAGE_PROVIDER=fake INSPECT_INLINE=1 GENERATION_INLINE=1`，`APP_URL=http://127.0.0.1:3200`） | **PASS** exit 0，87×E2E OK，含 V2 canvas commands 全段；验完 web/worker 进程已杀、:3200 已释放 |
| 视觉自验 | tabbit 浏览器 CDP `Target.createTarget` 持续失败（3 个 task 均无法新建页），**截图未成**；降级为 SSR HTML 验证：/ /login /register /projects /studio 全部带编译后 CSS 包（含全部 tokens/组件类）、零内联 hex 样式、class 结构正确（site-header/container/btn/input/stepper 等） |
| /api/me | 已返回 workspaces[].role（OWNER/ADMIN 判断无需 API 变更） |

**范围纪律（规则 13）发现但未修：** `apps/web` lint 脚本是 `next lint \|\| true`（实质不执行）；无页面级鉴权 middleware（页面依赖 API 401 + 前端引导）；多 workflow 切换器缺失；无组件测试框架；admin 页保留手工 workspaceId 输入（ops 工具定位）；原生 `<select>` 下拉项无法内嵌缩略图（仅做选中后预览）。
**Status:** **DONE** (not VERIFIED). Per V2 rule, VERIFIED requires a fresh-context re-review + owner merge + green main CI.
