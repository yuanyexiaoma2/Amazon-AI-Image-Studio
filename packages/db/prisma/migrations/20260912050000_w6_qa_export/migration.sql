-- W6: Market rule packs, QA reports/findings, approvals, export bundles

CREATE TYPE "QaFindingStatus" AS ENUM ('PASS', 'REVIEW', 'FAIL');
CREATE TYPE "QaReportOverallStatus" AS ENUM ('PASS', 'REVIEW', 'BLOCK');
CREATE TYPE "QaJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT', 'OVERRIDE_BLOCK', 'REVOKE');
CREATE TYPE "ExportBundleStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SUPERSEDED');

CREATE TABLE "global_market_rule_definitions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "marketplace_code" TEXT NOT NULL,
    "scope_json" JSONB NOT NULL,
    "priority" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "rules_json" JSONB NOT NULL,
    "source_urls_json" JSONB NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_market_rule_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_market_rule_definitions_key_version_key" ON "global_market_rule_definitions"("key", "version");

CREATE TABLE "global_market_rule_activations" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "environment" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "activated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_market_rule_activations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_market_rule_activations_key_environment_key" ON "global_market_rule_activations"("key", "environment");

CREATE TABLE "qa_reports" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "slot" TEXT,
    "shot_brief_id" UUID,
    "truth_revision_id" UUID,
    "workflow_revision_id" UUID,
    "rule_pack_key" TEXT NOT NULL,
    "rule_pack_version" INTEGER NOT NULL,
    "rule_pack_snapshot_json" JSONB NOT NULL,
    "rule_pack_sha256" TEXT NOT NULL,
    "overall_status" "QaReportOverallStatus",
    "status" "QaJobStatus" NOT NULL DEFAULT 'QUEUED',
    "input_fingerprint" TEXT,
    "vision_snapshot_json" JSONB,
    "ocr_snapshot_json" JSONB,
    "ocr_scenario" TEXT,
    "vision_scenario" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "error_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "qa_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "qa_reports_workspace_id_id_key" ON "qa_reports"("workspace_id", "id");
CREATE INDEX "qa_reports_workspace_id_project_id_created_at_idx" ON "qa_reports"("workspace_id", "project_id", "created_at");
CREATE INDEX "qa_reports_workspace_id_asset_version_id_idx" ON "qa_reports"("workspace_id", "asset_version_id");

ALTER TABLE "qa_reports" ADD CONSTRAINT "qa_reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qa_reports" ADD CONSTRAINT "qa_reports_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qa_reports" ADD CONSTRAINT "qa_reports_workspace_id_asset_version_id_fkey" FOREIGN KEY ("workspace_id", "asset_version_id") REFERENCES "asset_versions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "qa_findings" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "rule_id" TEXT NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "evaluator" TEXT NOT NULL,
    "status" "QaFindingStatus" NOT NULL,
    "severity" TEXT NOT NULL,
    "non_waivable" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION,
    "message" TEXT NOT NULL,
    "evidence_json" JSONB NOT NULL,
    "suggested_action" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_findings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "qa_findings_workspace_id_id_key" ON "qa_findings"("workspace_id", "id");
CREATE UNIQUE INDEX "qa_findings_workspace_id_report_id_rule_id_key" ON "qa_findings"("workspace_id", "report_id", "rule_id");
CREATE INDEX "qa_findings_workspace_id_report_id_idx" ON "qa_findings"("workspace_id", "report_id");

ALTER TABLE "qa_findings" ADD CONSTRAINT "qa_findings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qa_findings" ADD CONSTRAINT "qa_findings_workspace_id_report_id_fkey" FOREIGN KEY ("workspace_id", "report_id") REFERENCES "qa_reports"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "qa_report_id" UUID NOT NULL,
    "truth_revision_id" UUID NOT NULL,
    "shot_brief_revision_id" UUID,
    "workflow_revision_id" UUID,
    "input_fingerprint" TEXT,
    "decision" "ApprovalDecision" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_role" TEXT NOT NULL,
    "reason" TEXT,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approvals_workspace_id_id_key" ON "approvals"("workspace_id", "id");
CREATE INDEX "approvals_workspace_id_asset_version_id_decided_at_idx" ON "approvals"("workspace_id", "asset_version_id", "decided_at");
CREATE INDEX "approvals_workspace_id_qa_report_id_idx" ON "approvals"("workspace_id", "qa_report_id");

ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_asset_version_id_fkey" FOREIGN KEY ("workspace_id", "asset_version_id") REFERENCES "asset_versions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_qa_report_id_fkey" FOREIGN KEY ("workspace_id", "qa_report_id") REFERENCES "qa_reports"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "export_bundles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "ExportBundleStatus" NOT NULL DEFAULT 'QUEUED',
    "sku" TEXT NOT NULL,
    "marketplace_code" TEXT NOT NULL,
    "truth_revision_id" UUID,
    "rule_pack_key" TEXT NOT NULL,
    "rule_pack_version" INTEGER NOT NULL,
    "manifest_json" JSONB,
    "manifest_sha256" TEXT,
    "zip_storage_key" TEXT,
    "zip_sha256" TEXT,
    "zip_bytes" INTEGER,
    "error_json" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "export_bundles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "export_bundles_workspace_id_id_key" ON "export_bundles"("workspace_id", "id");
CREATE INDEX "export_bundles_workspace_id_project_id_created_at_idx" ON "export_bundles"("workspace_id", "project_id", "created_at");

ALTER TABLE "export_bundles" ADD CONSTRAINT "export_bundles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_bundles" ADD CONSTRAINT "export_bundles_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "export_bundle_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "bundle_id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "qa_report_id" UUID NOT NULL,
    "approval_id" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "variant_code" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "output_index" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "export_bundle_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "export_bundle_items_workspace_id_id_key" ON "export_bundle_items"("workspace_id", "id");
CREATE INDEX "export_bundle_items_workspace_id_bundle_id_idx" ON "export_bundle_items"("workspace_id", "bundle_id");

ALTER TABLE "export_bundle_items" ADD CONSTRAINT "export_bundle_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_bundle_items" ADD CONSTRAINT "export_bundle_items_workspace_id_bundle_id_fkey" FOREIGN KEY ("workspace_id", "bundle_id") REFERENCES "export_bundles"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_bundle_items" ADD CONSTRAINT "export_bundle_items_workspace_id_asset_version_id_fkey" FOREIGN KEY ("workspace_id", "asset_version_id") REFERENCES "asset_versions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_bundle_items" ADD CONSTRAINT "export_bundle_items_workspace_id_qa_report_id_fkey" FOREIGN KEY ("workspace_id", "qa_report_id") REFERENCES "qa_reports"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_bundle_items" ADD CONSTRAINT "export_bundle_items_workspace_id_approval_id_fkey" FOREIGN KEY ("workspace_id", "approval_id") REFERENCES "approvals"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
