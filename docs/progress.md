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
| W1-01 | Init monorepo | VERIFIED | pnpm workspace; `apps/web` (Next.js + `@xyflow/react`); `apps/worker` (BullMQ); packages `domain`, `contracts`, `db`, `storage`, `providers`, `config`. Second independent review approved against HEAD `6a88972723e8907b4e66a09c7ce53659505cf66a`. |
| W1-02 | Eng quality + CI | VERIFIED | TS strict; Prettier; Vitest; CI with Postgres/Redis/MinIO services, migrate, integration + real `test:e2e`. **Node 22** in `actions/setup-node` + `engines.node >=22`. Second independent review approved against HEAD `6a88972723e8907b4e66a09c7ce53659505cf66a`. |
| W1-03 | Local infra | VERIFIED | `infra/docker-compose.yml` / `compose.yaml`: Postgres 16, Redis 7, MinIO, optional Mailpit. Health runbook present. GHA is source of truth for health. Second independent review approved against HEAD `6a88972723e8907b4e66a09c7ce53659505cf66a`. |
| W1-04 | Env + logging | VERIFIED | `@studio/config` Zod env + fail-fast AUTH_SECRET in production. Second independent review approved against HEAD `6a88972723e8907b4e66a09c7ce53659505cf66a`. |
| W1-05 | Auth.js + register/login | VERIFIED | Credentials + Argon2id; JWT maxAge 24h; `User.sessionVersion`; `requireActiveSession`; change-password/disable; shared `PasswordSchema` (12–128); `normalizeEmail`; Redis login rate limit (IP+email, 5/15m). ADR-0002 + CR-0001. Second independent review approved against HEAD `6a88972723e8907b4e66a09c7ce53659505cf66a`. |
| W1-06 | Prisma tenant schema | VERIFIED | UUIDv7; workspace-scoped ProjectRepository; real-DB integration tests for cross-workspace deny + sessionVersion bumps. Second independent review approved against HEAD `6a88972723e8907b4e66a09c7ce53659505cf66a`. |
| W1-07 | OpenAPI + errors + request ID | VERIFIED | `pnpm openapi:generate`; middleware `x-request-id`. Second independent review approved against HEAD `6a88972723e8907b4e66a09c7ce53659505cf66a`. |
| W1-08 | Docs skeleton | VERIFIED | Spec; progress; ADR 0000–0002; CR-0001; `docs/architecture.md`; runbooks; `AGENTS.md` branch policy. Second independent review approved against HEAD `6a88972723e8907b4e66a09c7ce53659505cf66a`. |
| W1-09 | Forgot-password reset | TODO | **Not in this PR.** One-time token, SHA-256 hashed in DB, 30 min expiry, Local Mail Capture. Distinct from authenticated `change-password`. Never mark DONE/VERIFIED until implemented. |

### Review follow-ups on `fix/w1-verification` (PR #2)

| Fix | Status | Evidence |
|---|---|---|
| Unify password rules (register + change-password, Zod shared, 12–128) | DONE | `PasswordSchema` / `ChangePasswordRequestSchema` in `@studio/contracts`; tests 11 reject / 12 accept |
| Login failure rate limit (Redis, IP+email, 5/15m, no email-existence leak) | DONE | `apps/web/lib/login-rate-limit.ts` + auth wrapper 429; integration tests incl. key-delete = window expiry |
| Real E2E for sessionVersion (old cookie 401 after pw change / disable) | DONE | Extended `scripts/e2e-api.mjs` |
| Unified `normalizeEmail()` (trim + NFKC + lower) | DONE | `@studio/domain` + used by register schema, lookup, login |
| CI Node 22 / no false “warning eliminated” claim | DONE | `setup-node` node-version 22; engines `>=22`; PR notes honest |
| Forgot-password ledger task | DONE (task itself TODO) | W1-09 row above — explicit TODO |

### W1 Verification (this PR)

- Branch: `fix/w1-verification` — **second independent review APPROVED**.
- Second independent review approved against HEAD `6a88972723e8907b4e66a09c7ce53659505cf66a`.
- W1-01–W1-08 marked VERIFIED from that approval. W1-09 remains TODO. W0-02 remains BLOCKED_EXTERNAL.

---

## Commands verified (implementing agent — mark DONE only)

| Command | Result |
|---|---|
| `pnpm install` | Expected PASS on verification branch |
| `pnpm lint` / `typecheck` / `test` / `build` | Expected PASS in GHA with services |
| `pnpm db:migrate:deploy` | Migration `20260911120000_add_user_session_version` |
| `pnpm test:e2e` | Real API flow + sessionVersion revoke |
| Local Docker health | Optional; box may lack Docker — GHA is SoT |

---

## Later weeks (not started)

W2+ remain TODO per spec §24. Do **not** start W2 from this verification PR.

---

## Delivery note

- PR #1 (`feat/w0-w1-baseline`) closed — not W1 acceptance.
- Scaffold lives on `main`; verification work is `fix/w1-verification` → PR only.
