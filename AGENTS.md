# AGENTS.md — handoff for AI coding agents

1. Read `docs/specs/amazon-ai-image-studio-v1.1.md` (source of truth).
2. Read `docs/progress.md` and continue from the first incomplete task with dependencies met.
3. Do **not** copy Eximia or any reference-site branding/UI/assets.
4. Prefer Fake Provider until ADR-0001 is updated with authorized keys.
5. Domain package must stay free of Next.js / BullMQ / Prisma client imports.
6. Every task: implementation + tests + evidence in `docs/progress.md`.
7. Never commit secrets — only `.env.example`.
8. **Branch policy:** never push feature/fix commits straight to `main`. Use `feat/**` or `fix/**` branches and open a PR. Never force-push `main`.
9. Do **not** self-mark `VERIFIED` in `docs/progress.md`. `VERIFIED` requires an independent reviewer or fresh AI context.
10. Auth: JWT + `sessionVersion` (ADR-0002) — not silent DB-session assumption from v1.1.

## Standard commands

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d postgres redis minio
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm dev          # web
pnpm worker       # bullmq worker
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm openapi:generate
# E2E (server must be running):
pnpm --filter @studio/web start &
pnpm test:e2e
```
