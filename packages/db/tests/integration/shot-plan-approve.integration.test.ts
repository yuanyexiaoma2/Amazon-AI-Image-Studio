import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  canRoleApproveShotPlan,
  canRoleWriteShotPlan,
  DEFAULT_SEVEN_IMAGE_TEMPLATE,
} from '@studio/domain';
import {
  ProjectRepository,
  ShotPlanConflictError,
  ShotPlanRepository,
  ShotPlanValidationError,
  TruthPackRepository,
  UserRepository,
  newId,
} from '../../src/index.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('Shot Plan approve hardening (W3-A)', () => {
  const db = new PrismaClient();
  const users = new UserRepository(db);
  const projects = new ProjectRepository(db);
  const truth = new TruthPackRepository(db);
  const plans = new ShotPlanRepository(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('domain: WRITE OWNER/ADMIN/MEMBER; APPROVE OWNER/ADMIN/REVIEWER', () => {
    expect(canRoleWriteShotPlan('MEMBER')).toBe(true);
    expect(canRoleWriteShotPlan('REVIEWER')).toBe(false);
    expect(canRoleApproveShotPlan('MEMBER')).toBe(false);
    expect(canRoleApproveShotPlan('REVIEWER')).toBe(true);
  });

  async function seedApprovedTruth() {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `sp-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `SP-${suffix}`,
      name: 'Shot Plan Project',
    });
    const { revision } = await truth.saveNewRevision({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
      facts: [{ key: 'brand', value: 'Acme', status: 'CONFIRMED' }],
    });
    await truth.setRevisionStatus(workspace.id, revision.id, 'PENDING_REVIEW');
    await truth.approveRevision(workspace.id, project.id, revision.id, user.id);
    return { user, workspace, project, truthRevisionId: revision.id };
  }

  function briefsFromTemplate() {
    return DEFAULT_SEVEN_IMAGE_TEMPLATE.map((t) => ({
      slot: t.slot,
      purpose: t.purpose,
      orderIndex: t.orderIndex,
      must: [...t.must],
      mustNot: [...t.mustNot],
      qaPolicy: t.qaPolicy,
      aspectRatio: t.aspectRatio,
      targetPixels: { ...t.targetPixels },
      referencedAssetVersionIds: [] as string[],
    }));
  }

  it('cannot generate without approved Truth', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `nog-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `NOG-${suffix}`,
      name: 'No Truth',
    });
    await expect(
      plans.requireApprovedTruthRevision(workspace.id, project.id),
    ).rejects.toBeInstanceOf(ShotPlanValidationError);
    void user;
  });

  it('save revision FK to approved truth; approve atomic; concurrent second fails', async () => {
    const { user, workspace, project, truthRevisionId } = await seedApprovedTruth();
    const { revision } = await plans.saveNewRevision({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
      truthRevisionId,
      briefs: briefsFromTemplate(),
      readyForReview: true,
      provider: 'fake-shot-plan',
      modelId: 'fake-shot-plan-v1',
    });
    expect(revision.status).toBe('PENDING_REVIEW');
    expect(revision.truthRevisionId).toBe(truthRevisionId);
    expect(revision.briefs).toHaveLength(7);

    const approved = await plans.approveRevision(
      workspace.id,
      project.id,
      revision.id,
      user.id,
    );
    expect(approved.status).toBe('APPROVED');

    await expect(
      plans.approveRevision(workspace.id, project.id, revision.id, user.id),
    ).rejects.toBeInstanceOf(ShotPlanConflictError);

    const audits = await db.auditEvent.findMany({
      where: { workspaceId: workspace.id, subjectId: revision.id },
    });
    expect(audits.some((a) => a.action === 'shot_plan.approved')).toBe(true);
  });

  it('cross-project revision approve rejected', async () => {
    const a = await seedApprovedTruth();
    const b = await seedApprovedTruth();
    const { revision } = await plans.saveNewRevision({
      workspaceId: a.workspace.id,
      projectId: a.project.id,
      createdByUserId: a.user.id,
      truthRevisionId: a.truthRevisionId,
      briefs: briefsFromTemplate(),
    });
    await expect(
      plans.approveRevision(a.workspace.id, b.project.id, revision.id, a.user.id),
    ).rejects.toThrow();
  });
});
