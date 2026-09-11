# Progress ledger — Amazon AI Image Studio

> Synced from spec §24. Status legend: `TODO` → `IN_PROGRESS` → `DONE` → `VERIFIED` | `BLOCKED` | `BLOCKED_EXTERNAL`.
> **VERIFIED requires an independent reviewer or a fresh AI context** that re-ran acceptance checks.
> Implementing agents mark at most `DONE` with evidence — never self-`VERIFIED`.

**Repo type (W0-01):** GREENFIELD — empty public GitHub repo; no prior application code.

**Timezone note:** W1 verification branch work 2026-09-11 Asia/Shanghai (UTC+8).

---

## W0 / W1 status

| ID | Task | Status | Evidence / notes |
|---|---|---|---|
| W0-01 | Baseline Audit | DONE | Empty clone of `yuanyexiaoma2/Amazon-AI-Image-Studio`. No existing app/tests. Capability map: none. |
| W0-02 | Provider Capability / authorization | BLOCKED_EXTERNAL (ADR done) | ADR `docs/adr/0001-provider-capability.md`: Fake Provider default. Real keys/budget not provided. Never store real provider keys. |
| W1-01 | Init monorepo | DONE | pnpm workspace; `apps/web` (Next.js + `@xyflow/react`); `apps/worker` (BullMQ); packages `domain`, `contracts`, `db`, `storage`, `providers`, `config`. |
| W1-02 | Eng quality + CI | DONE | TS strict; Prettier; Vitest; CI with Postgres/Redis/MinIO services, migrate, integration + real `test:e2e`. Node 22. Branch policy documented. |
| W1-03 | Local infra | DONE | `infra/docker-compose.yml` / `compose.yaml`: Postgres 16, Redis 7, MinIO, optional Mailpit. Health runbook present. GHA is source of truth for health. |
| W1-04 | Env + logging | DONE | Downgraded from self-VERIFIED. `@studio/config` Zod env + fail-fast AUTH_SECRET in production. Independent VERIFIED pending. |
| W1-05 | Auth.js + register/login | DONE | Credentials + Argon2id; JWT maxAge 24h; `User.sessionVersion`; `requireActiveSession`; change-password/disable stubs; ADR-0002 + CR-0001. |
| W1-06 | Prisma tenant schema | DONE | UUIDv7; workspace-scoped ProjectRepository; real-DB integration tests for cross-workspace deny + sessionVersion bumps. |
| W1-07 | OpenAPI + errors + request ID | DONE | Downgraded from self-VERIFIED. `pnpm openapi:generate`; middleware `x-request-id`. Independent VERIFIED pending. |
| W1-08 | Docs skeleton | DONE | Spec; progress; ADR 0000–0002; CR-0001; `docs/architecture.md`; runbooks; `AGENTS.md` branch policy. |

### W1 Verification (this PR)

- Branch: `fix/w1-verification` — **pending independent review** (do not mark VERIFIED here).
- Evidence expected in PR: CI run URL, migrate output, integration/E2E logs, per-item table above.

---

## Commands verified (implementing agent — mark DONE only)

| Command | Result |
|---|---|
| `pnpm install` | Expected PASS on verification branch |
| `pnpm lint` / `typecheck` / `test` / `build` | Expected PASS in GHA with services |
| `pnpm db:migrate:deploy` | Migration `20260911120000_add_user_session_version` |
| `pnpm test:e2e` | Real API flow (no longer noop) |
| Local Docker health | Optional; box may lack Docker — GHA is SoT |

---

## Later weeks (not started)

W2+ remain TODO per spec §24. Do **not** start W2 from this verification PR.

---

## Delivery note

- PR #1 (`feat/w0-w1-baseline`) closed — not W1 acceptance.
- Scaffold lives on `main`; verification work is `fix/w1-verification` → PR only.
