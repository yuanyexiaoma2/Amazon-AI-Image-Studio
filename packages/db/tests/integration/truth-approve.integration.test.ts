import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { canRoleApproveTruth } from '@studio/domain';
import {
  AssetRepository,
  ProjectRepository,
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

    // Attempt approve revision of p1 while targeting p2
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
    // Add memberUser as MEMBER of owner's workspace
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

    // Create asset+version in workspace B
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
    // Still DRAFT — should fail
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
});
