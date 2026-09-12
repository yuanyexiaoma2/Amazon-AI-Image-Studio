import { describe, expect, it } from 'vitest';
import {
  canRoleApproveQa,
  canRoleExport,
  canRoleOverrideBlock,
  canRoleWriteQa,
  QA_APPROVE_ROLES,
  QA_EXPORT_ROLES,
  QA_OVERRIDE_ROLES,
  QA_WRITE_ROLES,
} from '../src/qa-approval.js';
import { canRoleApproveShotPlan, canRoleWriteShotPlan } from '../src/shot-plan.js';

describe('W8-04 authz role matrix (domain)', () => {
  it('WRITE / APPROVE / OVERRIDE / EXPORT roles match ADR matrix', () => {
    expect(QA_WRITE_ROLES).toEqual(['OWNER', 'ADMIN', 'MEMBER']);
    expect(QA_APPROVE_ROLES).toEqual(['OWNER', 'ADMIN', 'REVIEWER']);
    expect(QA_OVERRIDE_ROLES).toEqual(['OWNER', 'ADMIN']);
    expect(QA_EXPORT_ROLES).toContain('OWNER');
  });

  it('REVIEWER cannot write QA; MEMBER cannot approve / override', () => {
    expect(canRoleWriteQa('REVIEWER')).toBe(false);
    expect(canRoleApproveQa('MEMBER')).toBe(false);
    expect(canRoleOverrideBlock('MEMBER')).toBe(false);
    expect(canRoleOverrideBlock('REVIEWER')).toBe(false);
    expect(canRoleApproveQa('REVIEWER')).toBe(true);
    expect(canRoleExport('MEMBER')).toBe(true);
  });

  it('Shot Plan write vs approve roles', () => {
    expect(canRoleWriteShotPlan('MEMBER')).toBe(true);
    expect(canRoleWriteShotPlan('REVIEWER')).toBe(false);
    expect(canRoleApproveShotPlan('REVIEWER')).toBe(true);
    expect(canRoleApproveShotPlan('MEMBER')).toBe(false);
  });
});
