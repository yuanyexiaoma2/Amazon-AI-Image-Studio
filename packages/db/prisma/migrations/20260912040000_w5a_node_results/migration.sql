-- W5-A: NodeResult + fingerprint + STALE / SKIPPED_DEPENDENCY

CREATE TYPE "NodeExecutionStatus" AS ENUM ('IDLE', 'STALE', 'BLOCKED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

ALTER TYPE "GenerationItemStatus" ADD VALUE 'SKIPPED_DEPENDENCY';
ALTER TYPE "GenerationOutputDisposition" ADD VALUE 'STALE';

CREATE TABLE "node_results" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "workflow_revision_id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "status" "NodeExecutionStatus" NOT NULL DEFAULT 'IDLE',
    "input_fingerprint" TEXT,
    "stale_reason" TEXT,
    "stale_cause" TEXT,
    "output_json" JSONB NOT NULL DEFAULT '{}',
    "last_attempt_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "node_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "node_results_workspace_id_id_key" ON "node_results"("workspace_id", "id");
CREATE UNIQUE INDEX "node_results_workspace_id_workflow_revision_id_node_id_key" ON "node_results"("workspace_id", "workflow_revision_id", "node_id");
CREATE INDEX "node_results_workspace_id_project_id_status_idx" ON "node_results"("workspace_id", "project_id", "status");
CREATE INDEX "node_results_workspace_id_input_fingerprint_idx" ON "node_results"("workspace_id", "input_fingerprint");

ALTER TABLE "node_results" ADD CONSTRAINT "node_results_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "node_results" ADD CONSTRAINT "node_results_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "node_results" ADD CONSTRAINT "node_results_workspace_id_workflow_revision_id_fkey" FOREIGN KEY ("workspace_id", "workflow_revision_id") REFERENCES "workflow_revisions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "generation_attempts" ADD COLUMN "input_fingerprint" TEXT;
