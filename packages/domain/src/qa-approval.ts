/**
 * Approval / override / RBAC (spec §31.12).
 * qa_gate PASS is never a substitute for human Approval.
 */

import type { WorkspaceRoleName } from './truth.js';
import { hasNonWaivableFail, type QaFinding, type QaReportOverallStatus } from './qa-findings.js';

export const APPROVAL_DECISIONS = ['APPROVE', 'REJECT', 'OVERRIDE_BLOCK', 'REVOKE'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Spec Editor = MEMBER in this schema. */
export const QA_WRITE_ROLES: ReadonlyArray<WorkspaceRoleName> = ['OWNER', 'ADMIN', 'MEMBER'];
export const QA_APPROVE_ROLES: ReadonlyArray<WorkspaceRoleName> = ['OWNER', 'ADMIN', 'REVIEWER'];
export const QA_OVERRIDE_ROLES: ReadonlyArray<WorkspaceRoleName> = ['OWNER', 'ADMIN'];
export const QA_EXPORT_ROLES: ReadonlyArray<WorkspaceRoleName> = [
  'OWNER',
  'ADMIN',
  'MEMBER',
  'REVIEWER',
];

export function canRoleWriteQa(role: string): boolean {
  return (QA_WRITE_ROLES as readonly string[]).includes(role);
}

export function canRoleApproveQa(role: string): boolean {
  return (QA_APPROVE_ROLES as readonly string[]).includes(role);
}

export function canRoleOverrideBlock(role: string): boolean {
  return (QA_OVERRIDE_ROLES as readonly string[]).includes(role);
}

export function canRoleExport(role: string): boolean {
  return (QA_EXPORT_ROLES as readonly string[]).includes(role);
}

export type ApprovalRecord = {
  id: string;
  assetVersionId: string;
  qaReportId: string;
  truthRevisionId: string;
  shotBriefRevisionId: string | null;
  workflowRevisionId: string | null;
  inputFingerprint: string | null;
  decision: ApprovalDecision;
  actorUserId: string;
  actorRole: string;
  reason: string | null;
  decidedAt: string;
};

export type EffectiveApprovalContext = {
  assetVersionId: string;
  qaReportId: string;
  truthRevisionId: string;
  shotBriefRevisionId: string | null;
  workflowRevisionId?: string | null;
  inputFingerprint?: string | null;
  overallStatus: QaReportOverallStatus;
  findings: QaFinding[];
};

export type ApprovalGateResult =
  | { ok: true }
  | { ok: false; reason: string; code: 'FORBIDDEN' | 'VALIDATION_ERROR' | 'CONFLICT' };

export function validateApprovalDecision(input: {
  decision: ApprovalDecision;
  role: string;
  overallStatus: QaReportOverallStatus;
  findings: QaFinding[];
  reason?: string | null;
}): ApprovalGateResult {
  if (input.decision === 'OVERRIDE_BLOCK') {
    if (!canRoleOverrideBlock(input.role)) {
      return { ok: false, code: 'FORBIDDEN', reason: `Role ${input.role} cannot OVERRIDE_BLOCK` };
    }
    if (input.overallStatus !== 'BLOCK') {
      return { ok: false, code: 'VALIDATION_ERROR', reason: 'OVERRIDE_BLOCK requires a BLOCK report' };
    }
    if (!input.reason || !input.reason.trim()) {
      return { ok: false, code: 'VALIDATION_ERROR', reason: 'OVERRIDE_BLOCK requires a non-empty reason' };
    }
    if (hasNonWaivableFail(input.findings)) {
      return {
        ok: false,
        code: 'CONFLICT',
        reason: 'nonWaivable FAIL cannot be overridden — repair the asset and re-run QA',
      };
    }
    return { ok: true };
  }

  if (input.decision === 'APPROVE' || input.decision === 'REJECT') {
    if (!canRoleApproveQa(input.role)) {
      return { ok: false, code: 'FORBIDDEN', reason: `Role ${input.role} cannot ${input.decision}` };
    }
    if (input.decision === 'APPROVE' && input.overallStatus === 'BLOCK') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: 'BLOCK reports require OVERRIDE_BLOCK (OWNER/ADMIN) not APPROVE',
      };
    }
    if (hasNonWaivableFail(input.findings) && input.decision === 'APPROVE') {
      return {
        ok: false,
        code: 'CONFLICT',
        reason: 'nonWaivable FAIL cannot be approved',
      };
    }
    return { ok: true };
  }

  // REVOKE
  if (!canRoleApproveQa(input.role) && !canRoleOverrideBlock(input.role)) {
    return { ok: false, code: 'FORBIDDEN', reason: `Role ${input.role} cannot REVOKE` };
  }
  return { ok: true };
}

/**
 * Latest authorized decision is current iff APPROVE or OVERRIDE_BLOCK,
 * references still match production baseline, and no nonWaivable FAIL.
 */
export function computeEffectiveApproval(
  decisions: ApprovalRecord[],
  ctx: EffectiveApprovalContext,
): ApprovalRecord | null {
  if (decisions.length === 0) return null;
  const latest = [...decisions].sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : 1)).at(-1);
  if (!latest) return null;
  if (latest.decision !== 'APPROVE' && latest.decision !== 'OVERRIDE_BLOCK') return null;
  if (latest.assetVersionId !== ctx.assetVersionId) return null;
  if (latest.qaReportId !== ctx.qaReportId) return null;
  if (latest.truthRevisionId !== ctx.truthRevisionId) return null;
  if (
    latest.shotBriefRevisionId &&
    ctx.shotBriefRevisionId &&
    latest.shotBriefRevisionId !== ctx.shotBriefRevisionId
  ) {
    return null;
  }
  if (
    latest.workflowRevisionId &&
    ctx.workflowRevisionId &&
    latest.workflowRevisionId !== ctx.workflowRevisionId
  ) {
    return null;
  }
  if (
    latest.inputFingerprint &&
    ctx.inputFingerprint &&
    latest.inputFingerprint !== ctx.inputFingerprint
  ) {
    return null;
  }
  if (hasNonWaivableFail(ctx.findings)) return null;
  return latest;
}

export type ExportItemGate = {
  slot: string;
  overallStatus: QaReportOverallStatus;
  findings: QaFinding[];
  effective: ApprovalRecord | null;
};

export type ExportGateResult =
  | { ok: true }
  | { ok: false; reason: string; slot?: string };

/**
 * Default export is blocked by MAIN hard BLOCK without OVERRIDE_BLOCK.
 * Any item without effective human Approval fails (PASS ≠ Approval).
 */
export function assertExportAllowed(items: ExportItemGate[]): ExportGateResult {
  for (const item of items) {
    if (hasNonWaivableFail(item.findings)) {
      return {
        ok: false,
        slot: item.slot,
        reason: `${item.slot}: nonWaivable FAIL cannot be exported`,
      };
    }
    if (!item.effective) {
      return {
        ok: false,
        slot: item.slot,
        reason: `${item.slot}: no valid human Approval (qa_gate PASS is not Approval)`,
      };
    }
    if (
      item.slot === 'MAIN' &&
      item.overallStatus === 'BLOCK' &&
      item.effective.decision !== 'OVERRIDE_BLOCK'
    ) {
      return {
        ok: false,
        slot: item.slot,
        reason: 'MAIN hard rule BLOCK prevents default export',
      };
    }
  }
  return { ok: true };
}
