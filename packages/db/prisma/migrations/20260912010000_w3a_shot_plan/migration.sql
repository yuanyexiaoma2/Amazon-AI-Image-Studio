-- W3-A: Shot Plan / Shot Brief + audit events (MSG-003: FK to approved Truth revision)

CREATE TYPE "ShotPlanRevisionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SUPERSEDED');
CREATE TYPE "ShotBriefSlot" AS ENUM ('MAIN', 'FEATURE', 'DETAIL', 'DIMENSION', 'LIFESTYLE', 'PACKAGE');

CREATE TABLE "shot_plan_documents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "current_revision_id" UUID,
    "approved_revision_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shot_plan_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shot_plan_revisions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "ShotPlanRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "truth_revision_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT,
    "model_id" TEXT,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shot_plan_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shot_briefs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "shot_plan_revision_id" UUID NOT NULL,
    "slot" "ShotBriefSlot" NOT NULL,
    "purpose" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "copy_json" JSONB NOT NULL DEFAULT '[]',
    "constraints_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shot_briefs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shot_plan_documents_workspace_id_id_key" ON "shot_plan_documents"("workspace_id", "id");
CREATE UNIQUE INDEX "shot_plan_documents_workspace_id_project_id_key" ON "shot_plan_documents"("workspace_id", "project_id");

CREATE UNIQUE INDEX "shot_plan_revisions_workspace_id_id_key" ON "shot_plan_revisions"("workspace_id", "id");
CREATE UNIQUE INDEX "shot_plan_revisions_workspace_id_document_id_revision_key" ON "shot_plan_revisions"("workspace_id", "document_id", "revision");
CREATE INDEX "shot_plan_revisions_workspace_id_truth_revision_id_idx" ON "shot_plan_revisions"("workspace_id", "truth_revision_id");

CREATE UNIQUE INDEX "shot_briefs_workspace_id_id_key" ON "shot_briefs"("workspace_id", "id");
CREATE UNIQUE INDEX "shot_briefs_workspace_id_shot_plan_revision_id_order_index_key" ON "shot_briefs"("workspace_id", "shot_plan_revision_id", "order_index");
CREATE INDEX "shot_briefs_workspace_id_shot_plan_revision_id_idx" ON "shot_briefs"("workspace_id", "shot_plan_revision_id");

CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "audit_events"("workspace_id", "created_at");

ALTER TABLE "shot_plan_documents" ADD CONSTRAINT "shot_plan_documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shot_plan_documents" ADD CONSTRAINT "shot_plan_documents_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shot_plan_revisions" ADD CONSTRAINT "shot_plan_revisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shot_plan_revisions" ADD CONSTRAINT "shot_plan_revisions_workspace_id_document_id_fkey" FOREIGN KEY ("workspace_id", "document_id") REFERENCES "shot_plan_documents"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shot_plan_revisions" ADD CONSTRAINT "shot_plan_revisions_workspace_id_truth_revision_id_fkey" FOREIGN KEY ("workspace_id", "truth_revision_id") REFERENCES "product_truth_revisions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shot_briefs" ADD CONSTRAINT "shot_briefs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shot_briefs" ADD CONSTRAINT "shot_briefs_workspace_id_shot_plan_revision_id_fkey" FOREIGN KEY ("workspace_id", "shot_plan_revision_id") REFERENCES "shot_plan_revisions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Self-FK pointers on documents (after revisions table exists)
ALTER TABLE "shot_plan_documents" ADD CONSTRAINT "shot_plan_documents_workspace_id_current_revision_id_fkey" FOREIGN KEY ("workspace_id", "current_revision_id") REFERENCES "shot_plan_revisions"("workspace_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shot_plan_documents" ADD CONSTRAINT "shot_plan_documents_workspace_id_approved_revision_id_fkey" FOREIGN KEY ("workspace_id", "approved_revision_id") REFERENCES "shot_plan_revisions"("workspace_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
