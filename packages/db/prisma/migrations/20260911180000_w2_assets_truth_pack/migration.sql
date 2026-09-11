-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('CREATED', 'UPLOADING', 'UPLOADED', 'INSPECTING', 'READY', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('PRODUCT_PHOTO', 'REFERENCE', 'MASK', 'GENERATED', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssetRepresentationKind" AS ENUM ('ORIGINAL_UPLOAD', 'NORMALIZED_PNG', 'THUMBNAIL_WEBP', 'MASK_PNG', 'EDITOR_PREVIEW');

-- CreateEnum
CREATE TYPE "TruthRevisionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FactStatus" AS ENUM ('EXTRACTED', 'CONFIRMED', 'REJECTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ConstraintKind" AS ENUM ('LOCK', 'ALLOW', 'UNKNOWN');

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "expected_key" TEXT NOT NULL,
    "expected_mime" TEXT NOT NULL,
    "expected_bytes" INTEGER NOT NULL,
    "expected_checksum_sha256" TEXT,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'CREATED',
    "completion_key" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "rejection_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'PRODUCT_PHOTO',
    "status" "AssetStatus" NOT NULL DEFAULT 'UPLOADING',
    "current_version_id" UUID,
    "original_filename" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_versions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "primary_parent_version_id" UUID,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "color_space" TEXT,
    "byte_size" INTEGER NOT NULL,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_representations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "kind" "AssetRepresentationKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "content_type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_representations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "masks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "strokes_json" JSONB NOT NULL DEFAULT '[]',
    "coordinate_space" TEXT NOT NULL DEFAULT 'normalized_0_1',
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "masks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_truth_documents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "current_revision_id" UUID,
    "approved_revision_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_truth_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_truth_revisions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "TruthRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_truth_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_facts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "truth_revision_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "FactStatus" NOT NULL DEFAULT 'EXTRACTED',
    "evidence_asset_version_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_constraints" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "truth_revision_id" UUID NOT NULL,
    "kind" "ConstraintKind" NOT NULL,
    "path" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MUST',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_completion_key_key" ON "upload_sessions"("completion_key");

-- CreateIndex
CREATE INDEX "upload_sessions_workspace_id_project_id_status_idx" ON "upload_sessions"("workspace_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "upload_sessions_expires_at_idx" ON "upload_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_workspace_id_id_key" ON "upload_sessions"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "assets_workspace_id_project_id_status_idx" ON "assets"("workspace_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_workspace_id_id_key" ON "assets"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "asset_versions_workspace_id_sha256_idx" ON "asset_versions"("workspace_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_workspace_id_id_key" ON "asset_versions"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_workspace_id_asset_id_version_number_key" ON "asset_versions"("workspace_id", "asset_id", "version_number");

-- CreateIndex
CREATE INDEX "asset_representations_workspace_id_asset_version_id_idx" ON "asset_representations"("workspace_id", "asset_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_representations_workspace_id_id_key" ON "asset_representations"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_representations_workspace_id_asset_version_id_kind_key" ON "asset_representations"("workspace_id", "asset_version_id", "kind");

-- CreateIndex
CREATE INDEX "masks_workspace_id_asset_version_id_idx" ON "masks"("workspace_id", "asset_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "masks_workspace_id_id_key" ON "masks"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_truth_documents_workspace_id_id_key" ON "product_truth_documents"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_truth_documents_workspace_id_project_id_key" ON "product_truth_documents"("workspace_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_truth_revisions_workspace_id_id_key" ON "product_truth_revisions"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_truth_revisions_workspace_id_document_id_revision_key" ON "product_truth_revisions"("workspace_id", "document_id", "revision");

-- CreateIndex
CREATE INDEX "product_facts_workspace_id_truth_revision_id_idx" ON "product_facts"("workspace_id", "truth_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_facts_workspace_id_id_key" ON "product_facts"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_facts_workspace_id_truth_revision_id_key_key" ON "product_facts"("workspace_id", "truth_revision_id", "key");

-- CreateIndex
CREATE INDEX "product_constraints_workspace_id_truth_revision_id_kind_idx" ON "product_constraints"("workspace_id", "truth_revision_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "product_constraints_workspace_id_id_key" ON "product_constraints"("workspace_id", "id");

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_asset_id_fkey" FOREIGN KEY ("workspace_id", "asset_id") REFERENCES "assets"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_workspace_id_asset_id_fkey" FOREIGN KEY ("workspace_id", "asset_id") REFERENCES "assets"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_workspace_id_asset_version_id_fkey" FOREIGN KEY ("workspace_id", "asset_version_id") REFERENCES "asset_versions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "masks" ADD CONSTRAINT "masks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "masks" ADD CONSTRAINT "masks_workspace_id_asset_version_id_fkey" FOREIGN KEY ("workspace_id", "asset_version_id") REFERENCES "asset_versions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_truth_documents" ADD CONSTRAINT "product_truth_documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_truth_documents" ADD CONSTRAINT "product_truth_documents_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_truth_revisions" ADD CONSTRAINT "product_truth_revisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_truth_revisions" ADD CONSTRAINT "product_truth_revisions_workspace_id_document_id_fkey" FOREIGN KEY ("workspace_id", "document_id") REFERENCES "product_truth_documents"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_workspace_id_truth_revision_id_fkey" FOREIGN KEY ("workspace_id", "truth_revision_id") REFERENCES "product_truth_revisions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_constraints" ADD CONSTRAINT "product_constraints_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_constraints" ADD CONSTRAINT "product_constraints_workspace_id_truth_revision_id_fkey" FOREIGN KEY ("workspace_id", "truth_revision_id") REFERENCES "product_truth_revisions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

