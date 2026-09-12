import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEVEN_IMAGE_TEMPLATE,
  canApproveShotPlanRevision,
  canGenerateShotPlan,
  canRoleApproveShotPlan,
  canRoleWriteShotPlan,
  defaultTemplateHasPackage,
  isShotBriefSlot,
} from '../src/shot-plan.js';

describe('default 7-image template (spec §11.1)', () => {
  it('has exactly 7 briefs and no PACKAGE', () => {
    expect(DEFAULT_SEVEN_IMAGE_TEMPLATE).toHaveLength(7);
    expect(defaultTemplateHasPackage()).toBe(false);
    expect(DEFAULT_SEVEN_IMAGE_TEMPLATE.map((e) => e.slot)).toEqual([
      'MAIN',
      'FEATURE',
      'FEATURE',
      'DETAIL',
      'DIMENSION',
      'LIFESTYLE',
      'LIFESTYLE',
    ]);
  });

  it('orders 1..7 and includes all min types except PACKAGE', () => {
    expect(DEFAULT_SEVEN_IMAGE_TEMPLATE.map((e) => e.orderIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const slots = new Set(DEFAULT_SEVEN_IMAGE_TEMPLATE.map((e) => e.slot));
    for (const s of ['MAIN', 'FEATURE', 'DETAIL', 'DIMENSION', 'LIFESTYLE'] as const) {
      expect(slots.has(s)).toBe(true);
    }
  });

  it('recognizes PACKAGE as a valid slot for manual add', () => {
    expect(isShotBriefSlot('PACKAGE')).toBe(true);
    expect(isShotBriefSlot('UNKNOWN')).toBe(false);
  });
});

describe('shot plan gates', () => {
  it('blocks generate without approved Truth', () => {
    expect(canGenerateShotPlan({ hasApprovedTruthRevision: false }).ok).toBe(false);
    expect(canGenerateShotPlan({ hasApprovedTruthRevision: true }).ok).toBe(true);
  });

  it('blocks approve without approved Truth / wrong status / missing MAIN', () => {
    expect(
      canApproveShotPlanRevision({
        hasApprovedTruthRevision: false,
        revisionStatus: 'PENDING_REVIEW',
        briefs: [{ slot: 'MAIN' }],
      }).ok,
    ).toBe(false);
    expect(
      canApproveShotPlanRevision({
        hasApprovedTruthRevision: true,
        revisionStatus: 'DRAFT',
        briefs: [{ slot: 'MAIN' }],
      }).ok,
    ).toBe(false);
    expect(
      canApproveShotPlanRevision({
        hasApprovedTruthRevision: true,
        revisionStatus: 'PENDING_REVIEW',
        briefs: [{ slot: 'FEATURE' }],
      }).ok,
    ).toBe(false);
    expect(
      canApproveShotPlanRevision({
        hasApprovedTruthRevision: true,
        revisionStatus: 'PENDING_REVIEW',
        briefs: [{ slot: 'MAIN' }, { slot: 'FEATURE' }],
      }).ok,
    ).toBe(true);
  });

  it('role gates match Truth Pack: WRITE OWNER/ADMIN/MEMBER; APPROVE OWNER/ADMIN/REVIEWER', () => {
    expect(canRoleWriteShotPlan('MEMBER')).toBe(true);
    expect(canRoleWriteShotPlan('REVIEWER')).toBe(false);
    expect(canRoleApproveShotPlan('MEMBER')).toBe(false);
    expect(canRoleApproveShotPlan('REVIEWER')).toBe(true);
    expect(canRoleApproveShotPlan('OWNER')).toBe(true);
  });
});
