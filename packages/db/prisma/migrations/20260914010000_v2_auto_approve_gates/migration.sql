-- V2 planner agent: workspace-level auto-approve gates switch (personal self-use mode).
-- Approval logic is unchanged; when ON, server-side flows may auto-approve with audit trail.
ALTER TABLE "workspaces" ADD COLUMN "auto_approve_gates" BOOLEAN NOT NULL DEFAULT false;
