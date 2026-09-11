/** Product Truth Pack domain rules (spec §7.3, W2-04/06). */

export type FactStatus = 'EXTRACTED' | 'CONFIRMED' | 'REJECTED' | 'LOCKED';
export type TruthRevisionStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'SUPERSEDED';

const FACT_TRANSITIONS: Record<FactStatus, FactStatus[]> = {
  EXTRACTED: ['CONFIRMED', 'REJECTED', 'LOCKED'],
  CONFIRMED: ['LOCKED', 'REJECTED', 'EXTRACTED'],
  REJECTED: ['EXTRACTED', 'CONFIRMED'],
  LOCKED: ['CONFIRMED'], // unlock back to confirmed only via explicit unlock path
};

export function canTransitionFact(from: FactStatus, to: FactStatus): boolean {
  return FACT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Approve gate: every non-REJECTED fact must be CONFIRMED or LOCKED.
 * Empty fact list is not approvable.
 */
export function canApproveTruthRevision(
  facts: Array<{ status: FactStatus }>,
): { ok: true } | { ok: false; reason: string } {
  if (facts.length === 0) {
    return { ok: false, reason: 'No facts to approve' };
  }
  const blocking = facts.filter((f) => f.status === 'EXTRACTED');
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: `${blocking.length} fact(s) still EXTRACTED — confirm or reject each first`,
    };
  }
  const positive = facts.filter((f) => f.status === 'CONFIRMED' || f.status === 'LOCKED');
  if (positive.length === 0) {
    return { ok: false, reason: 'At least one CONFIRMED or LOCKED fact is required' };
  }
  return { ok: true };
}

export const DEFAULT_LOCK_PATHS = [
  'body silhouette',
  'lid geometry',
  'logo spelling and placement',
  'number of included items',
] as const;

export const DEFAULT_ALLOW_PATHS = ['background', 'surface', 'ambient lighting'] as const;

export type WorkspaceRoleName = 'OWNER' | 'ADMIN' | 'MEMBER' | 'REVIEWER';

/** Mutating Truth Pack ops (PUT / extract / confirm): OWNER/ADMIN/MEMBER only. */
export const TRUTH_WRITE_ROLES: ReadonlyArray<WorkspaceRoleName> = [
  'OWNER',
  'ADMIN',
  'MEMBER',
];

/** Approve: OWNER/ADMIN/REVIEWER. REVIEWER may read + approve only. */
export const TRUTH_APPROVE_ROLES: ReadonlyArray<WorkspaceRoleName> = [
  'OWNER',
  'ADMIN',
  'REVIEWER',
];

const APPROVE_ROLES: ReadonlySet<WorkspaceRoleName> = new Set(TRUTH_APPROVE_ROLES);
const WRITE_ROLES: ReadonlySet<WorkspaceRoleName> = new Set(TRUTH_WRITE_ROLES);

export function canRoleApproveTruth(role: string): boolean {
  return APPROVE_ROLES.has(role as WorkspaceRoleName);
}

export function canRoleWriteTruth(role: string): boolean {
  return WRITE_ROLES.has(role as WorkspaceRoleName);
}
