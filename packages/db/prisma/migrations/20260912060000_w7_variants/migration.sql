-- W7: Variants, components, batch runs, items

CREATE TYPE "VariantStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');
CREATE TYPE "VariantItemStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'SKIPPED', 'QA_PASS', 'QA_REVIEW', 'QA_BLOCK');
CREATE TYPE "VariantRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELED');

CREATE TABLE "variants" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "master_variant_id" UUID,
    "status" "VariantStatus" NOT NULL DEFAULT 'DRAFT',
    "workflow_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variants_workspace_id_id_key" ON "variants"("workspace_id", "id");
CREATE UNIQUE INDEX "variants_workspace_id_project_id_code_key" ON "variants"("workspace_id", "project_id", "code");
CREATE INDEX "variants_workspace_id_project_id_idx" ON "variants"("workspace_id", "project_id");

ALTER TABLE "variants" ADD CONSTRAINT "variants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variants" ADD CONSTRAINT "variants_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variants" ADD CONSTRAINT "variants_workspace_id_master_variant_id_fkey" FOREIGN KEY ("workspace_id", "master_variant_id") REFERENCES "variants"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "variant_components" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "component_key" TEXT NOT NULL,
    "color_hex" TEXT,
    "color_description" TEXT,
    "material" TEXT,
    "locks_json" JSONB NOT NULL DEFAULT '[]',
    "allowed_changes_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "variant_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variant_components_workspace_id_id_key" ON "variant_components"("workspace_id", "id");
CREATE UNIQUE INDEX "variant_components_workspace_id_variant_id_component_key_key" ON "variant_components"("workspace_id", "variant_id", "component_key");
CREATE INDEX "variant_components_workspace_id_variant_id_idx" ON "variant_components"("workspace_id", "variant_id");

ALTER TABLE "variant_components" ADD CONSTRAINT "variant_components_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_components" ADD CONSTRAINT "variant_components_workspace_id_variant_id_fkey" FOREIGN KEY ("workspace_id", "variant_id") REFERENCES "variants"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "variant_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "master_variant_id" UUID NOT NULL,
    "status" "VariantRunStatus" NOT NULL DEFAULT 'QUEUED',
    "budget_limit_json" JSONB,
    "estimate_microunits" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "confirm_budget" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "scenario_json" JSONB,
    "error_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "variant_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variant_runs_workspace_id_id_key" ON "variant_runs"("workspace_id", "id");
CREATE UNIQUE INDEX "variant_runs_workspace_id_idempotency_key_key" ON "variant_runs"("workspace_id", "idempotency_key");
CREATE INDEX "variant_runs_workspace_id_project_id_created_at_idx" ON "variant_runs"("workspace_id", "project_id", "created_at");

ALTER TABLE "variant_runs" ADD CONSTRAINT "variant_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_runs" ADD CONSTRAINT "variant_runs_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_runs" ADD CONSTRAINT "variant_runs_workspace_id_master_variant_id_fkey" FOREIGN KEY ("workspace_id", "master_variant_id") REFERENCES "variants"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "variant_run_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,

    CONSTRAINT "variant_run_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variant_run_members_workspace_id_id_key" ON "variant_run_members"("workspace_id", "id");
CREATE UNIQUE INDEX "variant_run_members_workspace_id_run_id_variant_id_key" ON "variant_run_members"("workspace_id", "run_id", "variant_id");

ALTER TABLE "variant_run_members" ADD CONSTRAINT "variant_run_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_run_members" ADD CONSTRAINT "variant_run_members_workspace_id_run_id_fkey" FOREIGN KEY ("workspace_id", "run_id") REFERENCES "variant_runs"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_run_members" ADD CONSTRAINT "variant_run_members_workspace_id_variant_id_fkey" FOREIGN KEY ("workspace_id", "variant_id") REFERENCES "variants"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "variant_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "variant_run_id" UUID,
    "shot_brief_id" UUID,
    "generation_item_id" UUID,
    "selected_asset_version_id" UUID,
    "qa_report_id" UUID,
    "slot" TEXT NOT NULL,
    "output_index" INTEGER NOT NULL DEFAULT 0,
    "status" "VariantItemStatus" NOT NULL DEFAULT 'PENDING',
    "error_class" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "variant_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variant_items_workspace_id_id_key" ON "variant_items"("workspace_id", "id");
CREATE INDEX "variant_items_workspace_id_variant_id_slot_idx" ON "variant_items"("workspace_id", "variant_id", "slot");
CREATE INDEX "variant_items_workspace_id_variant_run_id_idx" ON "variant_items"("workspace_id", "variant_run_id");

ALTER TABLE "variant_items" ADD CONSTRAINT "variant_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_items" ADD CONSTRAINT "variant_items_workspace_id_variant_id_fkey" FOREIGN KEY ("workspace_id", "variant_id") REFERENCES "variants"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_items" ADD CONSTRAINT "variant_items_workspace_id_variant_run_id_fkey" FOREIGN KEY ("workspace_id", "variant_run_id") REFERENCES "variant_runs"("workspace_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
