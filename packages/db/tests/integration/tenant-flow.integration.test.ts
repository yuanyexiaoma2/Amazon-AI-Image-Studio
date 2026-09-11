import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ProjectRepository } from '../../src/repositories/projects.js';
import { UserRepository } from '../../src/repositories/users.js';
import { newId } from '../../src/ids.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('Prisma real-DB tenant isolation', () => {
  const db = new PrismaClient();
  const users = new UserRepository(db);
  const projects = new ProjectRepository(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('creates project in workspace A and denies find from workspace B', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const a = await users.createWithDefaultWorkspace({
      email: `a-${suffix}@example.com`,
      passwordHash: 'argon2-placeholder-hash',
      name: 'User A',
      workspaceName: 'Workspace A',
    });
    const b = await users.createWithDefaultWorkspace({
      email: `b-${suffix}@example.com`,
      passwordHash: 'argon2-placeholder-hash',
      name: 'User B',
      workspaceName: 'Workspace B',
    });

    const project = await projects.create({
      workspaceId: a.workspace.id,
      sku: `SKU-${suffix}`,
      name: 'Tenant Project',
    });

    const fromA = await projects.findById(a.workspace.id, project.id);
    expect(fromA?.id).toBe(project.id);

    const fromB = await projects.findById(b.workspace.id, project.id);
    expect(fromB).toBeNull();

    const memberA = await users.isMemberOfWorkspace(a.user.id, a.workspace.id);
    const memberCross = await users.isMemberOfWorkspace(b.user.id, a.workspace.id);
    expect(memberA).toBe(true);
    expect(memberCross).toBe(false);
  });

  it('bumps sessionVersion on password change and disable', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user } = await users.createWithDefaultWorkspace({
      email: `sv-${suffix}@example.com`,
      passwordHash: 'hash-v0',
    });
    expect(user.sessionVersion).toBe(0);

    const afterPw = await users.changePassword(user.id, 'hash-v1');
    expect(afterPw.sessionVersion).toBe(1);

    const afterDisable = await users.disableAccount(user.id);
    expect(afterDisable.sessionVersion).toBe(2);
    expect(afterDisable.status).toBe('DISABLED');
  });
});
