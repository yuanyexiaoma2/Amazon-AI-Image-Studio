# AGENTS.md — handoff for AI coding agents

1. Read `docs/specs/amazon-ai-image-studio-v1.1.md` (source of truth).
2. Read `docs/progress.md` and continue from the first incomplete task with dependencies met.
3. Do **not** copy Eximia or any reference-site branding/UI/assets.
4. Prefer Fake Provider until ADR-0001 is updated with authorized keys. **Never** put real provider keys in the repo, `.env.example`, or commits.
5. Domain package must stay free of Next.js / BullMQ / Prisma client imports.
6. Every task: implementation + tests + evidence in `docs/progress.md`.
7. Never commit secrets — only `.env.example`.
8. **Branch policy:** never push feature/fix commits straight to `main`. Use `feat/**`, `feature/**`, or `fix/**` branches and open a PR. Never force-push `main`.
9. Do **not** self-mark `VERIFIED` in `docs/progress.md` within the same session/context that wrote the code. Implementers mark at most `DONE`. (See V2 review policy below — 外部审稿已停用。)
10. Auth: JWT + `sessionVersion` (ADR-0002) — not silent DB-session assumption from v1.1.

11. **Collaboration (V2, owner ruling 2026-09-14):** **Kimi Code = plan + implement**；外部审稿 bot（grok）额度用尽已停用；**所有者 = 最终合并闸门**。旧的"审稿 public APPROVED"要求对历史 PR（≤#19）仍然有效，自 V2 起由下方新规替代。
12. **V2 review gate（替代旧 VERIFIED gate）:**
    - a) 实现会话标记 `DONE` + 证据（lint/typecheck/test/build + 必要 e2e）。
    - b) `VERIFIED` 需要**全新上下文复审**：开一个**新会话**（与实现无共享上下文），只给 PR diff + 验收标准，重跑检查并在 PR 留言结论 + 记入 `docs/progress.md`。同一会话不得给自己的代码标 VERIFIED。
    - c) **合并动作由所有者执行或明确指示**（高风险：auth / 租户隔离 / DB migration / 计费 / 真实 Provider / 队列幂等 / 删除，必须所有者明确点头）。
    - d) VERIFIED = 全新上下文复审 PASS + 已合并 + main CI 绿。
13. **范围纪律：** 只完成当前任务指定的事。执行中发现任务范围外的问题，在 PR 描述或 `docs/progress.md` 里记录报告，但不得顺手修改。


## Review & delivery policy (W2+)

1. **Same-week related features** → one feature branch + **one milestone PR** (not one PR per tiny task).
2. **Continuous commits OK** on the feature branch; no per-commit human confirmation required.
3. **Every commit** must keep `lint` / `typecheck` / `test` / `build` runnable (CI-green trajectory).
4. After the feature is complete **and CI is green** → open one PR for **independent review**. Do not merge yourself.
5. **High-risk always need independent review before merge:** auth, tenant isolation, DB migrations, billing, real Provider calls, queue idempotency, deletion, compliance export.
6. **Pure docs / copy / style / test-maintenance** with CI green and **no behavior change** → can merge directly (still prefer PR).
7. **Weekly milestone acceptance**; not two-round review per small task.
8. After reviewer **CHANGES**: if fixes are scoped to the named issues and CI is green → **same reviewer quick re-check only**.
9. Status: implementer AI marks **DONE** (+ evidence). **VERIFIED** per V2 rule 12 above (fresh-context review + owner merge + main CI green); historical items cite 审稿 APPROVED archives.
10. **W2 acceptance unit** = full chain **upload → inspect → thumbnail → version → Truth Pack** (W2-01…W2-06; W2-07 BLOCKED_EXTERNAL until real SKUs).
11. **W3 split:** W3-A = W3-01/02; W3-B1 = W3-03/04/06 (canvas foundation); W3-B2 = W3-05/07/08 (nodes + materialize). Separate PRs/reviews (MSG-007).
12. **W4:** Model Registry / Run / Credits / Webhook / SSE = W4-01…06 one milestone PR; W4-07 BLOCKED_EXTERNAL; Fake only; DONE not VERIFIED.
13. **W5 split:** W5-A = W5-01/08/02 (+ webhook orphan); W5-B = 03/04/05; W5-C = 06/07. Fake only per ADR-0003.
14. **W6 Phase 1:** W6-01…08 one milestone PR (rules/findings/review/export/e2e). Fake OCR/Vision only; `qa_gate` PASS ≠ Approval. **VERIFIED** on main merge `15f4979` + 审稿 APPROVED on PR #16.
15. **W7:** W7-01…07 one milestone PR (variants/batch/QA/export/admin/runbooks). Fake only (ADR-0003). **VERIFIED** on main merge `21bd2e7` + tip CI `34697260457` + 审稿 APPROVED on PR #17.
16. **W8 Phase 1:** W8-01…07 one milestone PR (eval/hardening/security/UAT docs). Fake only / 3 synthetic SKUs (ADR-0003). **VERIFIED** on main merge `c57e316` + tip CI `34699179820` + 审稿 APPROVED on PR #18.
17. **W9 buffer + release:** docs only (`docs/release/go-no-go.md`, `backlog.md`, `monitoring.md`). **CONDITIONAL GO** for Fake/Phase 1; **NO-GO** real Production. W9-01 DONE (not self-VERIFIED). W9-02 `BLOCKED_EXTERNAL` — do not claim Production smoke passed. No new product modules (§19.9). No real keys.
18. **P2-A (Phase 2 sole milestone):** kie.ai plug-and-play (`IMAGE_PROVIDER=kie`). One branch / one PR / one review; **do not merge** without 审稿 APPROVED. Owner self-use acceptance = real trial; formal eval only if multi-user/company formal use (ADR-0003). Never commit real keys.
19. **V2 (current):** vision + roadmap in `docs/specs/v2-vision.md`. Order: **V2-A planner agent (PR #24, DONE) → PR-2 画布命令层/自由画布 → PR-1 UI 重构 → PR-4 聊天 Agent 面板**。单 KIE_API_KEY 双用途（生图 + LLM）。kie 集成坑见 v2-vision §5。

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
# IMPORTANT: the local .env may carry real providers (IMAGE_PROVIDER=kie etc.).
# Always start the web/worker for e2e with explicit Fake overrides, e.g.:
#   IMAGE_PROVIDER=fake CHAT_PROVIDER=fake PLANNER_PROVIDER=fake INSPECT_INLINE=1 GENERATION_INLINE=1 pnpm --filter @studio/web start &
pnpm --filter @studio/web start &
pnpm worker &
pnpm test:e2e
pnpm test:eval       # W8 Fake baseline report
pnpm test:stress-30  # W8 30-item Fake load report
# V2: real kie planner smoke (needs KIE_API_KEY in .env; ~0.01 credits):
node node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/cli.mjs packages/providers/smoke-kie.mts
```

## Environment notes (this Windows machine, 2026-09-14)

- Node 24 at `C:\Program Files\nodejs`（不在 Git Bash 默认 PATH；每个 shell 先 `export PATH="/c/Program Files/nodejs:$PATH"`）。
- `pnpm` 垫片在 `C:\Users\Administrator\bin\pnpm.cmd`（corepack 包装，已在 PATH）。
- Prisma CLI 需要 DATABASE_URL：先 `set -a && . ./.env && set +a`（根目录 `.env` 不会自动传给 packages/db）。
- `prisma generate` 偶发 EPERM（杀软占用 dll）：删掉对应 `query_engine-windows.dll.node*` 重试即可。
- docker CLI 不在 Git Bash PATH，但 Postgres/Redis/MinIO 容器通常在跑（5432/6379/9000 可通）。
- GitHub 无 `gh` CLI；用 `git credential fill` 取缓存凭据 + REST API 开 PR/留言。
- 临时起 web 自验后**必须关掉**（不留后台进程）。
