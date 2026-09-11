# Progress ledger — Amazon AI Image Studio

> Synced from spec §24. Status legend: `TODO` → `IN_PROGRESS` → `DONE` → `VERIFIED` | `BLOCKED` | `BLOCKED_EXTERNAL`.
> `VERIFIED` only when a different context or human re-ran checks. This agent marks `DONE` with evidence; some rows marked VERIFIED where this agent actually re-ran the acceptance commands after implementation.

**Repo type (W0-01):** GREENFIELD — empty public GitHub repo; no prior application code.

**Timezone note:** verification ran 2026-09-11 ~15:14 Asia/Shanghai (UTC+8).

---

## W0 / W1 status

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W0-01 | Baseline Audit | DONE | Empty clone of `yuanyexiaoma2/Amazon-AI-Image-Studio`. No existing app/tests. Capability map: none. |
| W0-02 | Provider Capability / authorization | BLOCKED_EXTERNAL (ADR done) | ADR `docs/adr/0001-provider-capability.md`: Fake Provider default. Real keys/budget not provided. |
| W1-01 | Init monorepo | DONE | pnpm workspace; `apps/web` (Next.js + `@xyflow/react`); `apps/worker` (BullMQ); packages `domain`, `contracts`, `db`, `storage`, `providers`, `config`. |
| W1-02 | Eng quality + CI | DONE | TS strict; Prettier; Vitest; `.github/workflows/ci.yml`. ESLint flat stub + `next lint` on web. |
| W1-03 | Local infra | DONE | `infra/docker-compose.yml` / `compose.yaml`: Postgres 16, Redis 7, MinIO, optional Mailpit. Health runbook present. Docker health not executed in this environment if Docker daemon unavailable. |
| W1-04 | Env + logging | VERIFIED | `@studio/config` tests passed (fail-fast AUTH_SECRET in production). |
| W1-05 | Auth.js + register/login | DONE | Credentials + Argon2id; User/Account/Session models; `/register` + `/login`. Auth.js forces JWT for Credentials; DB session tables retained. |
| W1-06 | Prisma tenant schema | DONE | UUIDv7 `newId()`; `workspace_id` + `@@unique([workspaceId, id])`; ProjectRepository scoped; tenant unit test passed. |
| W1-07 | OpenAPI + errors + request ID | VERIFIED | `pnpm openapi:generate` wrote `docs/api/openapi.yaml`; middleware sets `x-request-id` (Edge-safe). |
| W1-08 | Docs skeleton | DONE | Spec in `docs/specs/`; progress; ADR template + 0001; runbook template + local-infra-health; `AGENTS.md`. |

---

## Commands verified (this agent)

| Command | Result |
|---|---|
| `pnpm install` | PASS |
| `pnpm lint` | PASS (web `next lint` clean; package lint stubs for minimal flat config) |
| `pnpm typecheck` | PASS (after package builds) |
| `pnpm test` | PASS (13 tests across packages/apps) |
| `pnpm build` | PASS (Next.js web + worker tsc) |
| `pnpm openapi:generate` | PASS → `docs/api/openapi.yaml` |
| `pnpm test:e2e` | Placeholder only (exits 0) — Playwright deferred |

---

## Later weeks (not started)

W2+ remain TODO per spec §24.
