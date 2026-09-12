/**
 * Real API permission tests for Shot Plan mutating routes.
 * REVIEWER: read + approve only. OWNER/ADMIN/MEMBER: write. MEMBER: cannot approve.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();

vi.mock('../lib/auth', () => ({
  auth: () => authMock(),
}));

import {
  prisma,
  ProjectRepository,
  ShotPlanRepository,
  TruthPackRepository,
  UserRepository,
  newId,
} from '@studio/db';
import { DEFAULT_SEVEN_IMAGE_TEMPLATE } from '@studio/domain';
import { GET as getPlan, PUT as putPlan } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/shot-plans/route';
import { POST as postGenerate } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/shot-plans/generate/route';
import { POST as postApprove } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/shot-plans/approve/route';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

function ctx(workspaceId: string, projectId: string) {
  return { params: Promise.resolve({ workspaceId, projectId }) };
}

function asSession(userId: string, email: string, sessionVersion = 0) {
  authMock.mockResolvedValue({
    user: { id: userId, email },
    sessionVersion,
  });
}

describe.skipIf(!run)('Shot Plan API role gates (real route handlers)', () => {
  const users = new UserRepository(prisma);
  const projects = new ProjectRepository(prisma);
  const truth = new TruthPackRepository(prisma);
  const plans = new ShotPlanRepository(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  async function seed() {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const owner = await users.createWithDefaultWorkspace({
      email: `sp-owner-${suffix}@example.com`,
      passwordHash: 'hash',
      workspaceName: `SP-WS-${suffix}`,
    });
    const reviewer = await users.createWithDefaultWorkspace({
      email: `sp-rev-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const member = await users.createWithDefaultWorkspace({
      email: `sp-mem-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    await users.addMember({
      workspaceId: owner.workspace.id,
      userId: reviewer.user.id,
      role: 'REVIEWER',
    });
    await users.addMember({
      workspaceId: owner.workspace.id,
      userId: member.user.id,
      role: 'MEMBER',
    });
    const project = await projects.create({
      workspaceId: owner.workspace.id,
      sku: `SPSKU-${suffix}`,
      name: 'Shot Plan Roles',
    });
    const { revision } = await truth.saveNewRevision({
      workspaceId: owner.workspace.id,
      projectId: project.id,
      createdByUserId: owner.user.id,
      facts: [{ key: 'brand', value: 'Acme', status: 'CONFIRMED' }],
    });
    await truth.setRevisionStatus(owner.workspace.id, revision.id, 'PENDING_REVIEW');
    await truth.approveRevision(owner.workspace.id, project.id, revision.id, owner.user.id);
    return { owner, reviewer, member, project, truthRevisionId: revision.id };
  }

  it('API: REVIEWER denied generate/PUT; may GET and approve; MEMBER cannot approve', async () => {
    const { owner, reviewer, member, project } = await seed();
    const workspaceId = owner.workspace.id;
    const projectId = project.id;

    asSession(owner.user.id, owner.user.email);
    const gen = await postGenerate(
      new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      ctx(workspaceId, projectId),
    );
    expect(gen.status).toBe(201);
    const genJson = await gen.json();
    expect(genJson.provider).toBe('fake-shot-plan');
    expect(genJson.plan.revision.briefs).toHaveLength(7);
    expect(genJson.plan.canvasPayload.briefs).toHaveLength(7);

    asSession(reviewer.user.id, reviewer.user.email);
    const deniedGen = await postGenerate(
      new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      ctx(workspaceId, projectId),
    );
    expect(deniedGen.status).toBe(403);

    const deniedPut = await putPlan(
      new Request('http://localhost/shot-plans', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          briefs: DEFAULT_SEVEN_IMAGE_TEMPLATE.map((t) => ({
            slot: t.slot,
            purpose: t.purpose,
            orderIndex: t.orderIndex,
          })),
        }),
      }),
      ctx(workspaceId, projectId),
    );
    expect(deniedPut.status).toBe(403);

    const getRes = await getPlan(
      new Request('http://localhost/shot-plans', { method: 'GET' }),
      ctx(workspaceId, projectId),
    );
    expect(getRes.status).toBe(200);

    const approveRes = await postApprove(
      new Request('http://localhost/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revisionId: genJson.plan.revision.id }),
      }),
      ctx(workspaceId, projectId),
    );
    expect(approveRes.status).toBe(200);
    const approved = await approveRes.json();
    expect(approved.revision.status).toBe('APPROVED');

    // Fresh plan for MEMBER approve denial
    asSession(owner.user.id, owner.user.email);
    const gen2 = await postGenerate(
      new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      ctx(workspaceId, projectId),
    );
    const gen2Json = await gen2.json();
    asSession(member.user.id, member.user.email);
    const memApprove = await postApprove(
      new Request('http://localhost/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revisionId: gen2Json.plan.revision.id }),
      }),
      ctx(workspaceId, projectId),
    );
    expect(memApprove.status).toBe(403);

    // MEMBER may generate
    const memGen = await postGenerate(
      new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      ctx(workspaceId, projectId),
    );
    expect(memGen.status).toBe(201);
    void plans;
  });
});
