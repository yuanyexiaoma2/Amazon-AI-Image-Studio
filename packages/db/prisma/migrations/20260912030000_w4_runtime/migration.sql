-- CreateEnum
CREATE TYPE "GenerationRunStatus" AS ENUM ('DRAFT', 'VALIDATING', 'BLOCKED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "GenerationItemStatus" AS ENUM ('DRAFT', 'VALIDATING', 'BLOCKED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "GenerationAttemptStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProviderSubmissionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CreditEventType" AS ENUM ('GRANT', 'RESERVE', 'SETTLE', 'REFUND', 'RELEASE', 'ADJUST');

-- CreateEnum
CREATE TYPE "GenerationOutputDisposition" AS ENUM ('CURRENT', 'SUPERSEDED', 'LATE_AFTER_CANCEL', 'CORRUPT', 'REJECTED');

-- CreateTable
CREATE TABLE "model_registry_entries" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "operations_json" JSONB NOT NULL,
    "ratios_json" JSONB NOT NULL,
    "resolution_tiers_json" JSONB NOT NULL,
    "max_reference_images" INTEGER NOT NULL,
    "max_outputs" INTEGER NOT NULL,
    "supports_seed" BOOLEAN NOT NULL,
    "supports_webhook" BOOLEAN NOT NULL,
    "pricing_json" JSONB NOT NULL,
    "config_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "model_registry_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "workflow_revision_id" UUID NOT NULL,
    "scope_json" JSONB NOT NULL,
    "status" "GenerationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_user_id" UUID NOT NULL,
    "budget_limit_json" JSONB,
    "estimate_microunits" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "idempotency_key" TEXT NOT NULL,
    "confirm_budget" BOOLEAN NOT NULL DEFAULT false,
    "error_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "generation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "slot" TEXT,
    "variant_id" UUID,
    "output_index" INTEGER NOT NULL DEFAULT 0,
    "item_key" TEXT NOT NULL,
    "status" "GenerationItemStatus" NOT NULL DEFAULT 'QUEUED',
    "model_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "generation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_attempts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "model_snapshot_json" JSONB NOT NULL,
    "request_snapshot" JSONB NOT NULL,
    "status" "GenerationAttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "error_class" TEXT,
    "error_message" TEXT,
    "auto_retry_count" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "generation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_submissions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "external_job_id" TEXT,
    "submission_key" TEXT NOT NULL,
    "lease_token" TEXT,
    "heartbeat_at" TIMESTAMPTZ,
    "status" "ProviderSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "provider_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_outputs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "output_index" INTEGER NOT NULL,
    "asset_version_id" UUID,
    "disposition" "GenerationOutputDisposition" NOT NULL DEFAULT 'CURRENT',
    "mime_type" TEXT,
    "byte_size" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "external_job_id" TEXT,
    "payload_hash" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_accounts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "available_microunits" BIGINT NOT NULL DEFAULT 0,
    "held_microunits" BIGINT NOT NULL DEFAULT 0,
    "consumed_microunits" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" "CreditEventType" NOT NULL,
    "microunits" BIGINT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "attempt_id" UUID,
    "run_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_cost_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider_submission_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amount_numeric" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "settlement_key" TEXT NOT NULL,
    "provider_invoice_line_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_cost_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "run_id" UUID,
    "attempt_id" UUID,
    "type" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_registry_entries_key_key" ON "model_registry_entries"("key");

-- CreateIndex
CREATE INDEX "generation_runs_workspace_id_project_id_status_idx" ON "generation_runs"("workspace_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "generation_runs_workspace_id_workflow_revision_id_idx" ON "generation_runs"("workspace_id", "workflow_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_runs_workspace_id_id_key" ON "generation_runs"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_runs_workspace_id_idempotency_key_key" ON "generation_runs"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "generation_items_workspace_id_run_id_idx" ON "generation_items"("workspace_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_items_workspace_id_id_key" ON "generation_items"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_items_workspace_id_item_key_key" ON "generation_items"("workspace_id", "item_key");

-- CreateIndex
CREATE INDEX "generation_attempts_workspace_id_item_id_status_idx" ON "generation_attempts"("workspace_id", "item_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "generation_attempts_workspace_id_id_key" ON "generation_attempts"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_attempts_workspace_id_item_id_attempt_no_key" ON "generation_attempts"("workspace_id", "item_id", "attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "generation_attempts_workspace_id_idempotency_key_key" ON "generation_attempts"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "provider_submissions_workspace_id_id_key" ON "provider_submissions"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_submissions_workspace_id_attempt_id_key" ON "provider_submissions"("workspace_id", "attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_submissions_provider_submission_key_key" ON "provider_submissions"("provider", "submission_key");

-- CreateIndex
CREATE UNIQUE INDEX "provider_submissions_provider_external_job_id_key" ON "provider_submissions"("provider", "external_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_outputs_workspace_id_id_key" ON "generation_outputs"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_outputs_workspace_id_attempt_id_output_index_key" ON "generation_outputs"("workspace_id", "attempt_id", "output_index");

-- CreateIndex
CREATE INDEX "provider_events_provider_external_job_id_idx" ON "provider_events"("provider", "external_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_events_provider_external_event_id_key" ON "provider_events"("provider", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_accounts_workspace_id_key" ON "credit_accounts"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_accounts_workspace_id_id_key" ON "credit_accounts"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "credit_ledger_events_workspace_id_account_id_created_at_idx" ON "credit_ledger_events"("workspace_id", "account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_events_workspace_id_id_key" ON "credit_ledger_events"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_events_workspace_id_idempotency_key_key" ON "credit_ledger_events"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "provider_cost_events_workspace_id_provider_submission_id_idx" ON "provider_cost_events"("workspace_id", "provider_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_cost_events_workspace_id_id_key" ON "provider_cost_events"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_cost_events_settlement_key_key" ON "provider_cost_events"("settlement_key");

-- CreateIndex
CREATE INDEX "progress_events_workspace_id_project_id_created_at_idx" ON "progress_events"("workspace_id", "project_id", "created_at");

-- AddForeignKey
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_workspace_id_workflow_revision_id_fkey" FOREIGN KEY ("workspace_id", "workflow_revision_id") REFERENCES "workflow_revisions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_items" ADD CONSTRAINT "generation_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_items" ADD CONSTRAINT "generation_items_workspace_id_run_id_fkey" FOREIGN KEY ("workspace_id", "run_id") REFERENCES "generation_runs"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_workspace_id_item_id_fkey" FOREIGN KEY ("workspace_id", "item_id") REFERENCES "generation_items"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_submissions" ADD CONSTRAINT "provider_submissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_submissions" ADD CONSTRAINT "provider_submissions_workspace_id_attempt_id_fkey" FOREIGN KEY ("workspace_id", "attempt_id") REFERENCES "generation_attempts"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_outputs" ADD CONSTRAINT "generation_outputs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_outputs" ADD CONSTRAINT "generation_outputs_workspace_id_attempt_id_fkey" FOREIGN KEY ("workspace_id", "attempt_id") REFERENCES "generation_attempts"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_events" ADD CONSTRAINT "credit_ledger_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_events" ADD CONSTRAINT "credit_ledger_events_workspace_id_account_id_fkey" FOREIGN KEY ("workspace_id", "account_id") REFERENCES "credit_accounts"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_events" ADD CONSTRAINT "credit_ledger_events_workspace_id_attempt_id_fkey" FOREIGN KEY ("workspace_id", "attempt_id") REFERENCES "generation_attempts"("workspace_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_events" ADD CONSTRAINT "credit_ledger_events_workspace_id_run_id_fkey" FOREIGN KEY ("workspace_id", "run_id") REFERENCES "generation_runs"("workspace_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_cost_events" ADD CONSTRAINT "provider_cost_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_cost_events" ADD CONSTRAINT "provider_cost_events_workspace_id_provider_submission_id_fkey" FOREIGN KEY ("workspace_id", "provider_submission_id") REFERENCES "provider_submissions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_events" ADD CONSTRAINT "progress_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

