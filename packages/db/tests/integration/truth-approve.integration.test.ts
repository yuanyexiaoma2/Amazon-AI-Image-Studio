import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { canRoleApproveTruth, canRoleWriteTruth } from '@studio/domain';
import {
  AssetRepository,
  ProjectRepository,
  TruthPackConflictError,
  TruthPackRepository,
  UserRepository,
  newId,
} from '../../src/index.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('Truth Pack approve hardening', () => {
  const db = new PrismaClient();
  const users = new UserRepository(db);
  const projects = new ProjectRepository(db);
  const truth = new TruthPackRepository(db);
  const assets = new AssetRepository(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('domain: MEMBER cannot approve; OWNER/ADMIN/REVIEWER can', () => {
    expect(canRoleApproveTruth('MEMBER')).toBe(false);
    expect(canRoleApproveTruth('OWNER')).toBe(true);
    expect(canRoleApproveTruth('ADMIN')).toBe(true);
    expect(canRoleApproveTruth('REVIEWER')).toBe(true);
  });

  it('domain: REVIEWER cannot write Truth; OWNER/ADMIN/MEMBER can', () => {
    expect(canRoleWriteTruth('REVIEWER')).toBe(false);
    expect(canRoleWriteTruth('OWNER')).toBe(true);
    expect(canRoleWriteTruth('ADMIN')).toBe(true);
    expect(canRoleWriteTruth('MEMBER')).toBe(true);
  });

  it('cross-project revision approve rejected', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `ta-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const p1 = await projects.create({
      workspaceId: workspace.id,
      sku: `A-${suffix}`,
      name: 'Project A',
    });
    const p2 = await projects.create({
      workspaceId: workspace.id,
      sku: `B-${suffix}`,
      name: 'Project B',
    });

    const { revision: revA } = await truth.saveNewRevision({
      workspaceId: workspace.id,
      projectId: p1.id,
      createdByUserId: user.id,
      facts: [{ key: 'color', value: 'red', status: 'CONFIRMED' }],
    });
    await truth.setRevisionStatus(workspace.id, revA.id, 'PENDING_REVIEW');

    await expect(
      truth.approveRevision(workspace.id, p2.id, revA.id, user.id),
    ).rejects.toThrow();
  });

  it('MEMBER role is denied by canRoleApproveTruth (API uses this gate)', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const owner = await users.createWithDefaultWorkspace({
      email: `own-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const memberUser = await users.createWithDefaultWorkspace({
      email: `mem-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    await users.addMember({
      workspaceId: owner.workspace.id,
      userId: memberUser.user.id,
      role: 'MEMBER',
    });
    const membership = await users.getMembership(memberUser.user.id, owner.workspace.id);
    expect(membership?.role).toBe('MEMBER');
    expect(canRoleApproveTruth(membership!.role)).toBe(false);
  });

  it('evidence Asset Version must belong to current project AND workspace', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const a = await users.createWithDefaultWorkspace({
      email: `ev-a-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const b = await users.createWithDefaultWorkspace({
      email: `ev-b-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const projectA = await projects.create({
      workspaceId: a.workspace.id,
      sku: `EVA-${suffix}`,
      name: 'A',
    });
    const projectB = await projects.create({
      workspaceId: b.workspace.id,
      sku: `EVB-${suffix}`,
      name: 'B',
    });

    const assetB = await db.asset.create({
      data: {
        id: newId(),
        workspaceId: b.workspace.id,
        projectId: projectB.id,
        kind: 'PRODUCT_PHOTO',
        status: 'READY',
        createdByUserId: b.user.id,
      },
    });
    const versionB = await db.assetVersion.create({
      data: {
        id: newId(),
        workspaceId: b.workspace.id,
        assetId: assetB.id,
        versionNumber: 1,
        sha256: 'abc',
        mime: 'image/png',
        byteSize: 10,
      },
    });

    await expect(
      assets.assertVersionsInProject(a.workspace.id, projectA.id, [versionB.id]),
    ).rejects.toThrow(/Evidence|not in/);
  });

  it('approve requires PENDING_REVIEW and current revision', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `pr-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `PR-${suffix}`,
      name: 'P',
    });
    const { revision } = await truth.saveNewRevision({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
      facts: [{ key: 'brand', value: 'Acme', status: 'CONFIRMED' }],
    });
    await expect(
      truth.approveRevision(workspace.id, project.id, revision.id, user.id),
    ).rejects.toThrow(/PENDING_REVIEW/);

    await truth.setRevisionStatus(workspace.id, revision.id, 'PENDING_REVIEW');
    const approved = await truth.approveRevision(
      workspace.id,
      project.id,
      revision.id,
      user.id,
    );
    expect(approved.status).toBe('APPROVED');
  });

  it('concurrency: approve vs create new revision — no stale approve / no current pointer rewind', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `conc-rev-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `CR-${suffix}`,
      name: 'Concurrent Rev',
    });
    const { revision: revA } = await truth.saveNewRevision({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
      facts: [{ key: 'brand', value: 'Acme', status: 'CONFIRMED' }],
    });
    await truth.setRevisionStatus(workspace.id, revA.id, 'PENDING_REVIEW');

    const outcomes = await Promise.allSettled([
      truth.approveRevision(workspace.id, project.id, revA.id, user.id),
      truth.saveNewRevision({
        workspaceId: workspace.id,
        projectId: project.id,
        createdByUserId: user.id,
        facts: [{ key: 'brand', value: 'Acme2', status: 'EXTRACTED' }],
      }),
    ]);

    const approveOutcome = outcomes[0]!;
    const createOutcome = outcomes[1]!;
    expect(createOutcome.status).toBe('fulfilled');

    const doc = await truth.getDocument(workspace.id, project.id);
    expect(doc).toBeTruthy();
    const current = await truth.getRevisionWithDetails(workspace.id, doc!.currentRevisionId!);
    expect(current).toBeTruthy();

    if (approveOutcome.status === 'fulfilled') {
      // Approve won (before or after create). Must not leave approved pointer on a non-matching stale state:
      // approved revision is A; current may still be A (approve after create failed to move? create always moves)
      // or current is the newer revision if create ran after approve.
      expect(approveOutcome.value.status).toBe('APPROVED');
      expect(doc!.approvedRevisionId).toBe(revA.id);
      // Current pointer must never be rewound incorrectly: if current !== A, it must be a newer revision.
      if (doc!.currentRevisionId !== revA.id) {
        expect(current!.revision).toBeGreaterThan(revA.revision);
      }
      // Exactly one APPROVED among A and any newer — A is APPROVED
      const revAAfter = await truth.getRevisionWithDetails(workspace.id, revA.id);
      expect(revAAfter!.status).toBe('APPROVED');
    } else {
      // Create won first: approve must fail; current is the new revision; A not APPROVED via successful approve
      expect(approveOutcome.status).toBe('rejected');
      expect(doc!.currentRevisionId).not.toBe(revA.id);
      expect(doc!.approvedRevisionId).not.toBe(revA.id);
      const revAAfter = await truth.getRevisionWithDetails(workspace.id, revA.id);
      expect(revAAfter!.status).not.toBe('APPROVED');
      expect(current!.id).toBe(doc!.currentRevisionId);
    }

    // Never: approved=A while current was moved to B and then rewound back by a late approve
    // (conditional update prevents rewind). If approved=A and current=A, create must not have left a
    // higher revision as current — already covered above.
  });

  it('concurrency: approve vs confirm — no APPROVED+EXTRACTED; no mutate after approve', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `conc-cf-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `CF-${suffix}`,
      name: 'Concurrent Confirm',
    });
    const { revision } = await truth.saveNewRevision({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
      facts: [{ key: 'material', value: 'steel', status: 'CONFIRMED' }],
    });
    await truth.setRevisionStatus(workspace.id, revision.id, 'PENDING_REVIEW');
    const factId = revision.facts[0]!.id;

    const outcomes = await Promise.allSettled([
      truth.approveRevision(workspace.id, project.id, revision.id, user.id),
      truth.updateFactStatuses(workspace.id, [{ factId, status: 'EXTRACTED' }]),
    ]);

    const approveOutcome = outcomes[0]!;
    const confirmOutcome = outcomes[1]!;

    const after = await truth.getRevisionWithDetails(workspace.id, revision.id);
    expect(after).toBeTruthy();

    if (after!.status === 'APPROVED') {
      expect(approveOutcome.status).toBe('fulfilled');
      // Must not still have EXTRACTED facts
      expect(after!.facts.every((f) => f.status !== 'EXTRACTED')).toBe(true);
      // Confirm must not have mutated after approve (either failed or ran before)
      if (confirmOutcome.status === 'fulfilled') {
        // confirm ran first then approve — facts were EXTRACTED then approve would fail.
        // So if APPROVED, confirm cannot have left EXTRACTED; if confirm fulfilled while APPROVED,
        // that would mean confirm mutated after — forbidden. With locks, confirm after approve rejects.
        expect(after!.facts[0]!.status).not.toBe('EXTRACTED');
      } else {
        expect(confirmOutcome.status).toBe('rejected');
        expect(confirmOutcome.reason).toBeInstanceOf(TruthPackConflictError);
      }
    } else {
      // Approve failed because confirm flipped to EXTRACTED first
      expect(approveOutcome.status).toBe('rejected');
      expect(after!.facts.some((f) => f.status === 'EXTRACTED')).toBe(true);
      expect(confirmOutcome.status).toBe('fulfilled');
    }

    // Hard invariant
    if (after!.status === 'APPROVED') {
      expect(after!.facts.some((f) => f.status === 'EXTRACTED')).toBe(false);
    }
  });

  it('atomic approve: concurrent double-approve allows exactly one success', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `dbl-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `DBL-${suffix}`,
      name: 'Double Approve',
    });
    const { revision } = await truth.saveNewRevision({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
      facts: [{ key: 'size', value: 'L', status: 'CONFIRMED' }],
    });
    await truth.setRevisionStatus(workspace.id, revision.id, 'PENDING_REVIEW');

    const outcomes = await Promise.allSettled([
      truth.approveRevision(workspace.id, project.id, revision.id, user.id),
      truth.approveRevision(workspace.id, project.id, revision.id, user.id),
    ]);
    const successes = outcomes.filter((o) => o.status === 'fulfilled');
    const failures = outcomes.filter((o) => o.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const after = await truth.getRevisionWithDetails(workspace.id, revision.id);
    expect(after!.status).toBe('APPROVED');
    const doc = await truth.getDocument(workspace.id, project.id);
    expect(doc!.approvedRevisionId).toBe(revision.id);
  });
});
