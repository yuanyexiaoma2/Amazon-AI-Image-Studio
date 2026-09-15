-- V2 PR-4: chat_sessions + chat_messages — chat agent sessions and immutable messages.
-- Sessions carry an optional per-session budget (budget_limit_json) and a
-- spent_microunits accumulator checked by the session budget gate; assistant
-- messages reference the applied command batch via batch_id.

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "workflow_id" UUID,
    "title" TEXT,
    "budget_limit_json" JSONB,
    "spent_microunits" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content_json" JSONB NOT NULL,
    "batch_id" UUID,
    "provider" TEXT,
    "model_id" TEXT,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_sessions_workspace_id_id_key" ON "chat_sessions"("workspace_id", "id");
CREATE INDEX "chat_sessions_workspace_id_project_id_created_at_idx" ON "chat_sessions"("workspace_id", "project_id", "created_at");
CREATE UNIQUE INDEX "chat_messages_workspace_id_id_key" ON "chat_messages"("workspace_id", "id");
CREATE INDEX "chat_messages_workspace_id_session_id_created_at_idx" ON "chat_messages"("workspace_id", "session_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workspace_id_workflow_id_fkey" FOREIGN KEY ("workspace_id", "workflow_id") REFERENCES "workflows"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_workspace_id_session_id_fkey" FOREIGN KEY ("workspace_id", "session_id") REFERENCES "chat_sessions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
