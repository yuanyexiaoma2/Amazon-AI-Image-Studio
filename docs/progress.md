# Progress ledger — Amazon AI Image Studio

> Synced from spec §24. Status legend: `TODO` → `IN_PROGRESS` → `DONE` → `VERIFIED` | `BLOCKED` | `BLOCKED_EXTERNAL`.
> **VERIFIED requires an independent reviewer or a fresh AI context** that re-ran acceptance checks.
> Implementing agents mark at most `DONE` with evidence — never self-`VERIFIED`.

**Repo type (W0-01):** GREENFIELD — empty public GitHub repo; no prior application code.

**Timezone note:** W2 milestone work 2026-09-11 Asia/Shanghai (UTC+8).

---

## Review policy (documented W2)

See `AGENTS.md` and `docs/architecture.md`: same-week related work → one milestone PR; continuous commits OK; DONE by implementer; VERIFIED at weekly/high-risk review; W2 acceptance = full upload→Truth Pack chain.

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
| W2-07 | Fixture baseline (10 real SKUs) | BLOCKED_EXTERNAL | Only **3 synthetic SKUs** in `fixtures/eval-products/`. Still need **~10 real SKUs** (rights-cleared). **素材由项目所有者在 QA 周前提供.** Does not block W2/W3 core merge; must **not** be VERIFIED. |

### W2 commands / evidence (implementer)

| Command | Result |
|---|---|
| `pnpm db:migrate:deploy` | Includes `20260911180000_w2_assets_truth_pack` |
| `pnpm lint` / `typecheck` / `test` / `build` | Required green before PR |
| `pnpm test:e2e` | Extends to upload→inspect→extract→confirm→approve (with MinIO + `INSPECT_INLINE=1`) |
| Secrets | No real provider keys in repo / `.env.example` / commits |

**VERIFIED (W2-01…W2-06):** Independent review APPROVED on PR #3; merged to main as `79996ac9cd0f3e824bc1c0a608c4aa9d75fbcaa6`; main CI green https://github.com/yuanyexiaoma2/Amazon-AI-Image-Studio/actions/runs/34586631130.

**W2-07** remains BLOCKED_EXTERNAL until owner provides ~10 real SKUs before QA week.

---

## W3 — Shot Plan + Studio canvas (next milestone)

**Branch:** `feature/w3-shot-plan` (from main after this docs PR).  
**Acceptance unit (one milestone PR, one independent review):** W3-01…W3-08 per spec §19.3 —

- Shot Plan / Brief + default 7-image template
- AI plan draft + human approve
- `@xyflow/react` Studio layout
- Node registry, typed ports, edge validation, cycle detection
- 11 node UI shells + config schemas
- Draft autosave, optimistic lock, revision snapshot
- Undo/redo, copy/paste, delete impact, fit view
- Shot Plan → workflow materialization

Week gate: Truth Pack → 7-image workflow; refresh keeps graph; illegal edges blocked; concurrent edits conflict (no silent overwrite).

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W3-01 | Shot Plan/Brief + 7-image template | TODO | |
| W3-02 | Plan generate + approve | TODO | Fake planner until W0-02 unblocked |
| W3-03 | Studio / `@xyflow/react` layout | TODO | |
| W3-04 | Nodes/ports/cycle detection | TODO | |
| W3-05 | 11 node config schemas | TODO | |
| W3-06 | Autosave / revision | TODO | |
| W3-07 | Canvas interactions | TODO | |
| W3-08 | Plan → canvas materialize | TODO | |

---

## Later weeks

W4+ remain TODO per spec §24.
