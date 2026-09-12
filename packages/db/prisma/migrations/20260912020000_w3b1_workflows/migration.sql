-- W3-B1: workflows + drafts (optimistic revision_number) + immutable revisions

CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "current_revision_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_drafts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "graph_json" JSONB NOT NULL,
    "revision_number" INTEGER NOT NULL DEFAULT 0,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_revisions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "graph_json" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflows_workspace_id_id_key" ON "workflows"("workspace_id", "id");
CREATE INDEX "workflows_workspace_id_project_id_idx" ON "workflows"("workspace_id", "project_id");

CREATE UNIQUE INDEX "workflow_drafts_workspace_id_id_key" ON "workflow_drafts"("workspace_id", "id");
CREATE UNIQUE INDEX "workflow_drafts_workspace_id_workflow_id_key" ON "workflow_drafts"("workspace_id", "workflow_id");

CREATE UNIQUE INDEX "workflow_revisions_workspace_id_id_key" ON "workflow_revisions"("workspace_id", "id");
CREATE UNIQUE INDEX "workflow_revisions_workspace_id_workflow_id_revision_key" ON "workflow_revisions"("workspace_id", "workflow_id", "revision");

ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_drafts" ADD CONSTRAINT "workflow_drafts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_drafts" ADD CONSTRAINT "workflow_drafts_workspace_id_workflow_id_fkey" FOREIGN KEY ("workspace_id", "workflow_id") REFERENCES "workflows"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_workspace_id_workflow_id_fkey" FOREIGN KEY ("workspace_id", "workflow_id") REFERENCES "workflows"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workspace_id_current_revision_id_fkey" FOREIGN KEY ("workspace_id", "current_revision_id") REFERENCES "workflow_revisions"("workspace_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
