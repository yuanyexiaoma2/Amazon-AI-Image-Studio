/**
 * Shot Plan / Shot Brief domain rules (spec §7.4, §11.1, W3-01/W3-02).
 * PACKAGE is a valid type but is NOT in the default 7-image template.
 */

import type { WorkspaceRoleName } from './truth.js';

export type ShotBriefSlot =
  | 'MAIN'
  | 'FEATURE'
  | 'DETAIL'
  | 'DIMENSION'
  | 'LIFESTYLE'
  | 'PACKAGE';

export type ShotPlanRevisionStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'SUPERSEDED';

export type ShotBriefTemplateEntry = {
  slot: ShotBriefSlot;
  purpose: string;
  orderIndex: number;
  aspectRatio: string;
  targetPixels: { width: number; height: number };
  must: string[];
  mustNot: string[];
  qaPolicy: string;
};

/** Spec §11.1 default 7-image Amazon template — PACKAGE excluded. */
export const DEFAULT_SEVEN_IMAGE_TEMPLATE: ReadonlyArray<ShotBriefTemplateEntry> = [
  {
    slot: 'MAIN',
    purpose: 'Amazon search results main image',
    orderIndex: 1,
    aspectRatio: '1:1',
    targetPixels: { width: 2000, height: 2000 },
    must: [
      'pure white background',
      'show only included items',
      'preserve exact product geometry and printed text',
      'product fully inside frame',
    ],
    mustNot: [
      'overlay text',
      'watermark',
      'border',
      'decorative prop',
      'badge',
      'unincluded accessory',
    ],
    qaPolicy: 'amazon-main-us-v1',
  },
  {
    slot: 'FEATURE',
    purpose: 'First core selling point',
    orderIndex: 2,
    aspectRatio: '1:1',
    targetPixels: { width: 2000, height: 2000 },
    must: ['one primary selling point', 'copy from confirmed facts only'],
    mustNot: ['invented specifications', 'unconfirmed claims'],
    qaPolicy: 'amazon-feature-us-v1',
  },
  {
    slot: 'FEATURE',
    purpose: 'Second core selling point (material / structure)',
    orderIndex: 3,
    aspectRatio: '1:1',
    targetPixels: { width: 2000, height: 2000 },
    must: ['material or structure focus', 'geometry stays truthful'],
    mustNot: ['invented specifications'],
    qaPolicy: 'amazon-feature-us-v1',
  },
  {
    slot: 'DETAIL',
    purpose: 'Close-up of real interface or material',
    orderIndex: 4,
    aspectRatio: '1:1',
    targetPixels: { width: 2000, height: 2000 },
    must: ['magnify real interface or material', 'keep geometric truth'],
    mustNot: ['fake ports or textures'],
    qaPolicy: 'amazon-detail-us-v1',
  },
  {
    slot: 'DIMENSION',
    purpose: 'Size / capacity callout',
    orderIndex: 5,
    aspectRatio: '1:1',
    targetPixels: { width: 2000, height: 2000 },
    must: ['use only confirmed numbers and units'],
    mustNot: ['guessed dimensions'],
    qaPolicy: 'amazon-dimension-us-v1',
  },
  {
    slot: 'LIFESTYLE',
    purpose: 'In-use scene',
    orderIndex: 6,
    aspectRatio: '1:1',
    targetPixels: { width: 2000, height: 2000 },
    must: ['product remains truthful', 'people and environment do not dominate'],
    mustNot: ['unproven performance claims'],
    qaPolicy: 'amazon-lifestyle-us-v1',
  },
  {
    slot: 'LIFESTYLE',
    purpose: 'Target audience / situational context',
    orderIndex: 7,
    aspectRatio: '1:1',
    targetPixels: { width: 2000, height: 2000 },
    must: ['situational context without overclaiming'],
    mustNot: ['unproven performance promises'],
    qaPolicy: 'amazon-lifestyle-us-v1',
  },
] as const;

export const SHOT_BRIEF_SLOTS: ReadonlyArray<ShotBriefSlot> = [
  'MAIN',
  'FEATURE',
  'DETAIL',
  'DIMENSION',
  'LIFESTYLE',
  'PACKAGE',
];

export function isShotBriefSlot(value: string): value is ShotBriefSlot {
  return (SHOT_BRIEF_SLOTS as ReadonlyArray<string>).includes(value);
}

export function defaultTemplateHasPackage(): boolean {
  return DEFAULT_SEVEN_IMAGE_TEMPLATE.some((e) => e.slot === 'PACKAGE');
}


/** Mutating Shot Plan ops (generate / PUT): OWNER/ADMIN/MEMBER only. */
export const SHOT_PLAN_WRITE_ROLES: ReadonlyArray<WorkspaceRoleName> = [
  'OWNER',
  'ADMIN',
  'MEMBER',
];

/** Approve: OWNER/ADMIN/REVIEWER. REVIEWER may read + approve only. */
export const SHOT_PLAN_APPROVE_ROLES: ReadonlyArray<WorkspaceRoleName> = [
  'OWNER',
  'ADMIN',
  'REVIEWER',
];

const WRITE_ROLES: ReadonlySet<WorkspaceRoleName> = new Set(SHOT_PLAN_WRITE_ROLES);
const APPROVE_ROLES: ReadonlySet<WorkspaceRoleName> = new Set(SHOT_PLAN_APPROVE_ROLES);

export function canRoleWriteShotPlan(role: string): boolean {
  return WRITE_ROLES.has(role as WorkspaceRoleName);
}

export function canRoleApproveShotPlan(role: string): boolean {
  return APPROVE_ROLES.has(role as WorkspaceRoleName);
}

/**
 * Approve gate for a Shot Plan revision.
 * - Truth Pack must already have an approved revision (W2-06).
 * - Revision must be PENDING_REVIEW.
 * - At least one brief required; MAIN slot required.
 */
export function canApproveShotPlanRevision(args: {
  hasApprovedTruthRevision: boolean;
  revisionStatus: ShotPlanRevisionStatus | string;
  briefs: Array<{ slot: string }>;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.hasApprovedTruthRevision) {
    return {
      ok: false,
      reason: 'Cannot approve Shot Plan without an approved Truth Pack revision (W2-06)',
    };
  }
  if (args.revisionStatus !== 'PENDING_REVIEW') {
    return {
      ok: false,
      reason: `Shot Plan revision status must be PENDING_REVIEW (got ${args.revisionStatus})`,
    };
  }
  if (args.briefs.length === 0) {
    return { ok: false, reason: 'Shot Plan has no briefs' };
  }
  if (!args.briefs.some((b) => b.slot === 'MAIN')) {
    return { ok: false, reason: 'Shot Plan must include a MAIN brief' };
  }
  return { ok: true };
}

/** Generate gate: approved Truth Pack required before AI draft. */
export function canGenerateShotPlan(args: {
  hasApprovedTruthRevision: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.hasApprovedTruthRevision) {
    return {
      ok: false,
      reason: 'Cannot generate Shot Plan without an approved Truth Pack revision (W2-06)',
    };
  }
  return { ok: true };
}
