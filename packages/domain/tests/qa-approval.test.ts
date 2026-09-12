import { describe, expect, it } from 'vitest';
import {
  assertExportAllowed,
  canRoleApproveQa,
  canRoleOverrideBlock,
  computeEffectiveApproval,
  validateApprovalDecision,
  type ApprovalRecord,
  type QaFinding,
} from '../src/index.js';

const passFinding: QaFinding = {
  ruleId: 'FILE.DECODABLE',
  ruleVersion: 1,
  evaluator: 'file.decodable.v1',
  status: 'PASS',
  severity: 'CRITICAL',
  nonWaivable: true,
  message: 'ok',
  evidence: { candidateAssetVersionId: 'av', regions: [] },
};

const nwFail: QaFinding = { ...passFinding, status: 'FAIL', message: 'bad' };

function rec(partial: Partial<ApprovalRecord>): ApprovalRecord {
  return {
    id: 'ap1',
    assetVersionId: 'av',
    qaReportId: 'qr',
    truthRevisionId: 'tr',
    shotBriefRevisionId: 'br',
    workflowRevisionId: null,
    inputFingerprint: 'fp',
    decision: 'APPROVE',
    actorUserId: 'u',
    actorRole: 'OWNER',
    reason: null,
    decidedAt: '2026-09-12T00:00:00.000Z',
    ...partial,
  };
}

describe('W6-06 approval roles', () => {
  it('MEMBER cannot approve; REVIEWER cannot override', () => {
    expect(canRoleApproveQa('MEMBER')).toBe(false);
    expect(canRoleApproveQa('REVIEWER')).toBe(true);
    expect(canRoleOverrideBlock('REVIEWER')).toBe(false);
    expect(canRoleOverrideBlock('OWNER')).toBe(true);
  });

  it('BLOCK cannot be APPROVE; OVERRIDE needs reason', () => {
    expect(
      validateApprovalDecision({
        decision: 'APPROVE',
        role: 'OWNER',
        overallStatus: 'BLOCK',
        findings: [passFinding],
      }).ok,
    ).toBe(false);
    expect(
      validateApprovalDecision({
        decision: 'OVERRIDE_BLOCK',
        role: 'OWNER',
        overallStatus: 'BLOCK',
        findings: [passFinding],
        reason: '',
      }).ok,
    ).toBe(false);
    expect(
      validateApprovalDecision({
        decision: 'OVERRIDE_BLOCK',
        role: 'OWNER',
        overallStatus: 'BLOCK',
        findings: [passFinding],
        reason: 'ops accept',
      }).ok,
    ).toBe(true);
  });

  it('nonWaivable FAIL cannot OVERRIDE', () => {
    const r = validateApprovalDecision({
      decision: 'OVERRIDE_BLOCK',
      role: 'OWNER',
      overallStatus: 'BLOCK',
      findings: [nwFail],
      reason: 'please',
    });
    expect(r.ok).toBe(false);
  });

  it('effective approval stale after truth change', () => {
    const latest = rec({});
    const ctx = {
      assetVersionId: 'av',
      qaReportId: 'qr',
      truthRevisionId: 'tr-NEW',
      shotBriefRevisionId: 'br',
      inputFingerprint: 'fp',
      overallStatus: 'PASS' as const,
      findings: [passFinding],
    };
    expect(computeEffectiveApproval([latest], ctx)).toBeNull();
    expect(
      computeEffectiveApproval([latest], { ...ctx, truthRevisionId: 'tr' })?.id,
    ).toBe('ap1');
  });

  it('MAIN BLOCK without OVERRIDE blocks export; PASS without approval also blocked', () => {
    const noAp = assertExportAllowed([
      { slot: 'MAIN', overallStatus: 'PASS', findings: [passFinding], effective: null },
    ]);
    expect(noAp.ok).toBe(false);
    if (!noAp.ok) expect(noAp.reason).toMatch(/not Approval/);

    const blocked = assertExportAllowed([
      {
        slot: 'MAIN',
        overallStatus: 'BLOCK',
        findings: [{ ...passFinding, status: 'FAIL', nonWaivable: false, severity: 'HIGH' }],
        effective: rec({ decision: 'APPROVE' }),
      },
    ]);
    expect(blocked.ok).toBe(false);

    const overridden = assertExportAllowed([
      {
        slot: 'MAIN',
        overallStatus: 'BLOCK',
        findings: [{ ...passFinding, status: 'FAIL', nonWaivable: false, severity: 'HIGH' }],
        effective: rec({ decision: 'OVERRIDE_BLOCK', reason: 'ship' }),
      },
    ]);
    expect(overridden.ok).toBe(true);
  });
});
