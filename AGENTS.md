# AGENTS.md — handoff for AI coding agents

1. Read `docs/specs/amazon-ai-image-studio-v1.1.md` (source of truth).
2. Read `docs/progress.md` and continue from the first incomplete task with dependencies met.
3. Do **not** copy Eximia or any reference-site branding/UI/assets.
4. Prefer Fake Provider until ADR-0001 is updated with authorized keys. **Never** put real provider keys in the repo, `.env.example`, or commits.
5. Domain package must stay free of Next.js / BullMQ / Prisma client imports.
6. Every task: implementation + tests + evidence in `docs/progress.md`.
7. Never commit secrets — only `.env.example`.
8. **Branch policy:** never push feature/fix commits straight to `main`. Use `feat/**`, `feature/**`, or `fix/**` branches and open a PR. Never force-push `main`.
9. Do **not** self-mark `VERIFIED` in `docs/progress.md`. `VERIFIED` requires an independent reviewer or fresh AI context. Implementers mark at most `DONE`.
10. Auth: JWT + `sessionVersion` (ADR-0002) — not silent DB-session assumption from v1.1.

11. **Collaboration:** Kimi = planning/ADR via GitHub issue #7; 马奇 = implement; 审稿 = independent review. Do not self-merge high-risk or VERIFIED ledger PRs.
12. **VERIFIED gate (forward rule):** For any PR that promotes tasks to `VERIFIED` in `docs/progress.md`, a **public APPROVED comment from 审稿 on that PR must exist before merge**. Do not merge first and backfill later (one-time exception for PR #6 is closed).


## Review & delivery policy (W2+)

1. **Same-week related features** → one feature branch + **one milestone PR** (not one PR per tiny task).
2. **Continuous commits OK** on the feature branch; no per-commit human confirmation required.
3. **Every commit** must keep `lint` / `typecheck` / `test` / `build` runnable (CI-green trajectory).
4. After the feature is complete **and CI is green** → open one PR for **independent review**. Do not merge yourself.
5. **High-risk always need independent review before merge:** auth, tenant isolation, DB migrations, billing, real Provider calls, queue idempotency, deletion, compliance export.
6. **Pure docs / copy / style / test-maintenance** with CI green and **no behavior change** → can merge directly (still prefer PR).
7. **Weekly milestone acceptance**; not two-round review per small task.
8. After reviewer **CHANGES**: if fixes are scoped to the named issues and CI is green → **same reviewer quick re-check only**.
9. Status: implementer AI marks **DONE** (+ evidence). **VERIFIED** only after **审稿** posts a **public APPROVED** on the PR **before** merge (then ledger may say VERIFIED).
10. **W2 acceptance unit** = full chain **upload → inspect → thumbnail → version → Truth Pack** (W2-01…W2-06; W2-07 BLOCKED_EXTERNAL until real SKUs).
11. **W3 split:** W3-A = W3-01/02; W3-B1 = W3-03/04/06 (canvas foundation); W3-B2 = W3-05/07/08 (nodes + materialize). Separate PRs/reviews (MSG-007).
12. **W4:** Model Registry / Run / Credits / Webhook / SSE = W4-01…06 one milestone PR; W4-07 BLOCKED_EXTERNAL; Fake only; DONE not VERIFIED.
13. **W5 split:** W5-A = W5-01/08/02 (+ webhook orphan); W5-B = 03/04/05; W5-C = 06/07. Fake only per ADR-0003.
14. **W6 Phase 1:** W6-01…08 one milestone PR (rules/findings/review/export/e2e). Fake OCR/Vision only; `qa_gate` PASS ≠ Approval. **VERIFIED** on main merge `15f4979` + 审稿 APPROVED on PR #16.
15. **W7:** W7-01…07 one milestone PR (variants/batch/QA/export/admin/runbooks). Fake only (ADR-0003). **VERIFIED** on main merge `21bd2e7` + tip CI `34697260457` + 审稿 APPROVED on PR #17.
16. **W8 Phase 1:** W8-01…07 one milestone PR (eval/hardening/security/UAT docs). Fake only / 3 synthetic SKUs (ADR-0003). **VERIFIED** on main merge `c57e316` + tip CI `34699179820` + 审稿 APPROVED on PR #18.
17. **W9 buffer + release:** docs only (`docs/release/go-no-go.md`, `backlog.md`, `monitoring.md`). **CONDITIONAL GO** for Fake/Phase 1; **NO-GO** real Production. W9-01 DONE (not self-VERIFIED). W9-02 `BLOCKED_EXTERNAL` — do not claim Production smoke passed. No new product modules (§19.9). No real keys.
18. **P2-A (Phase 2 sole milestone):** kie.ai plug-and-play (`IMAGE_PROVIDER=kie`). One branch / one PR / one review; **do not merge** without 审稿 APPROVED. Owner self-use acceptance = real trial; formal eval only if multi-user/company formal use (ADR-0003). Never commit real keys.

## Standard commands

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d postgres redis minio
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm dev          # web
pnpm worker       # bullmq worker (inspect + truth extract)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm openapi:generate
# E2E (web + worker must be running; or set INSPECT_INLINE=1 for in-process inspect):
pnpm --filter @studio/web start &
pnpm worker &
pnpm test:e2e
pnpm test:eval       # W8 Fake baseline report
pnpm test:stress-30  # W8 30-item Fake load report
```
