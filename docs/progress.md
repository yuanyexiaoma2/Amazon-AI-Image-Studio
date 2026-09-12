# Progress ledger — Amazon AI Image Studio

> Synced from spec §24. Status legend: `TODO` → `IN_PROGRESS` → `DONE` → `VERIFIED` | `BLOCKED` | `BLOCKED_EXTERNAL`.
> **VERIFIED requires an independent reviewer or a fresh AI context** that re-ran acceptance checks.
> Implementing agents mark at most `DONE` with evidence — never self-`VERIFIED`.

**Repo type (W0-01):** GREENFIELD — empty public GitHub repo; no prior application code.

**Timezone note:** W2 milestone work 2026-09-11 Asia/Shanghai (UTC+8). W3-A / W3-B1 work 2026-09-12 Asia/Shanghai (UTC+8).

---

## Review policy (documented W2)

See `AGENTS.md` and `docs/architecture.md`: same-week related work → one milestone PR; continuous commits OK; DONE by implementer; VERIFIED at weekly/high-risk review; W2 acceptance = full upload→Truth Pack chain. W3 is split into W3-A (plan), W3-B1 (canvas foundation), and W3-B2 (nodes/materialize); each is one milestone PR + one independent review.

---

## W0 / W1 status

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W0-01 | Baseline Audit | DONE | Empty clone of `yuanyexiaoma2/Amazon-AI-Image-Studio`. No existing app/tests. Capability map: none. |
| W0-02 | Provider Capability / authorization | BLOCKED_EXTERNAL (ADR done) | ADR `docs/adr/0001-provider-capability.md`: Fake Provider default. Real keys/budget not provided. Never store real provider keys. |
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
| W2-07 | Fixture baseline (10 real SKUs) | BLOCKED_EXTERNAL | Only **3 synthetic SKUs** in `fixtures/eval-products/`. Still need **~10 real SKUs** (rights-cleared). **素材由项目所有者按 fixtures 现有格式提供，QA 周前到位。** Does not block W2/W3-A/B core merge; must **not** be VERIFIED. |

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
| W3-05 | 11 node config schemas | TODO | **W3-B2** — Zod schemas in contracts; UI shells beyond registry stubs. |
| W3-06 | Autosave / revision | DONE | Prisma `workflows` / `workflow_drafts` / `workflow_revisions` + migration `20260912020000_w3b1_workflows`; PATCH `ifRevision` → 409 `WORKFLOW_REVISION_CONFLICT`; snapshot API; integration + e2e conflict tests. |
| W3-07 | Canvas interactions | TODO | **W3-B2** — undo/redo, copy/paste, delete impact, rich fit-view UX. |
| W3-08 | Plan → canvas materialize | TODO | **W3-B2** — consume W3-A `canvasPayload` unchanged; validate `referencedAssetVersionIds`. |

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

---

## Later weeks

W4+ remain TODO per spec §24.
