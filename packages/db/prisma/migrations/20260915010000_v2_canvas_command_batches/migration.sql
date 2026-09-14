-- V2 PR-2: workflow_command_batches — applied canvas command batches
-- Idempotent by (workflow_id, batch_id); before/after graphs + undone_at power undo/redo.

CREATE TABLE "workflow_command_batches" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "commands_json" JSONB NOT NULL,
    "before_graph_json" JSONB NOT NULL,
    "after_graph_json" JSONB NOT NULL,
    "base_revision_number" INTEGER NOT NULL,
    "result_revision_number" INTEGER NOT NULL,
    "undone_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_command_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_command_batches_workspace_id_id_key" ON "workflow_command_batches"("workspace_id", "id");
CREATE UNIQUE INDEX "workflow_command_batches_workflow_id_batch_id_key" ON "workflow_command_batches"("workflow_id", "batch_id");
CREATE INDEX "workflow_command_batches_workflow_id_created_at_idx" ON "workflow_command_batches"("workflow_id", "created_at");

ALTER TABLE "workflow_command_batches" ADD CONSTRAINT "workflow_command_batches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_command_batches" ADD CONSTRAINT "workflow_command_batches_workspace_id_workflow_id_fkey" FOREIGN KEY ("workspace_id", "workflow_id") REFERENCES "workflows"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
