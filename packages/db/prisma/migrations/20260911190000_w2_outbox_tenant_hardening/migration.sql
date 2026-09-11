-- Expand/contract-friendly W2 hardening:
-- 1) completionKey uniqueness becomes tenant-scoped
-- 2) composite FKs for current/approved/parent pointers
-- 3) transactional outbox for inspect publish reliability

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "job_name" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_messages_job_id_key" ON "outbox_messages"("job_id");

-- CreateIndex
CREATE INDEX "outbox_messages_status_created_at_idx" ON "outbox_messages"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_messages_workspace_id_id_key" ON "outbox_messages"("workspace_id", "id");

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant-scoped completion key (expand: add new unique, then drop global unique)
CREATE UNIQUE INDEX "upload_sessions_workspace_id_completion_key_key"
  ON "upload_sessions"("workspace_id", "completion_key");

DROP INDEX IF EXISTS "upload_sessions_completion_key_key";

-- Composite FKs for pointer columns (nullable; ON DELETE SET NULL)
ALTER TABLE "assets"
  ADD CONSTRAINT "assets_workspace_id_current_version_id_fkey"
  FOREIGN KEY ("workspace_id", "current_version_id")
  REFERENCES "asset_versions"("workspace_id", "id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_versions"
  ADD CONSTRAINT "asset_versions_workspace_id_primary_parent_version_id_fkey"
  FOREIGN KEY ("workspace_id", "primary_parent_version_id")
  REFERENCES "asset_versions"("workspace_id", "id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_truth_documents"
  ADD CONSTRAINT "product_truth_documents_workspace_id_current_revision_id_fkey"
  FOREIGN KEY ("workspace_id", "current_revision_id")
  REFERENCES "product_truth_revisions"("workspace_id", "id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_truth_documents"
  ADD CONSTRAINT "product_truth_documents_workspace_id_approved_revision_id_fkey"
  FOREIGN KEY ("workspace_id", "approved_revision_id")
  REFERENCES "product_truth_revisions"("workspace_id", "id")
  ON DELETE SET NULL ON UPDATE CASCADE;
