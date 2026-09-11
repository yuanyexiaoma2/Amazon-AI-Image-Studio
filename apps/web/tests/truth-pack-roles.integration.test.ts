/**
 * Real API permission tests for Truth Pack mutating routes.
 * Hits route handlers with mocked Auth.js session + real DB memberships.
 * REVIEWER: read + approve only. OWNER/ADMIN/MEMBER: write. MEMBER: cannot approve.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();

vi.mock('../lib/auth', () => ({
  auth: () => authMock(),
}));

import { prisma, ProjectRepository, TruthPackRepository, UserRepository, newId } from '@studio/db';
import { PUT as putTruth } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/truth-pack/route';
import { GET as getTruth } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/truth-pack/route';
import { POST as postConfirm } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/truth-pack/confirm/route';
import { POST as postExtract } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/truth-pack/extract/route';
import { POST as postApprove } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/truth-pack/approve/route';

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

describe.skipIf(!run)('Truth Pack API role gates (real route handlers)', () => {
  const users = new UserRepository(prisma);
  const projects = new ProjectRepository(prisma);
  const truth = new TruthPackRepository(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  async function seedWorkspace() {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const owner = await users.createWithDefaultWorkspace({
      email: `owner-${suffix}@example.com`,
      passwordHash: 'hash',
      workspaceName: `WS-${suffix}`,
    });
    const reviewer = await users.createWithDefaultWorkspace({
      email: `rev-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const member = await users.createWithDefaultWorkspace({
      email: `mem-${suffix}@example.com`,
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
      sku: `SKU-${suffix}`,
      name: 'Role Gate Project',
    });
    return { suffix, owner, reviewer, member, project };
  }

  it('API: REVIEWER is denied PUT / extract / confirm but may GET and approve', async () => {
    const { owner, reviewer, project } = await seedWorkspace();
    const workspaceId = owner.workspace.id;
    const projectId = project.id;

    // Owner seeds a revision for approve later
    asSession(owner.user.id, owner.user.email);
    const { revision } = await truth.saveNewRevision({
      workspaceId,
      projectId,
      createdByUserId: owner.user.id,
      facts: [{ key: 'brand', value: 'Acme', status: 'CONFIRMED' }],
    });
    await truth.setRevisionStatus(workspaceId, revision.id, 'PENDING_REVIEW');

    asSession(reviewer.user.id, reviewer.user.email);

    const getRes = await getTruth(
      new Request('http://localhost/truth-pack', { method: 'GET' }),
      ctx(workspaceId, projectId),
    );
    expect(getRes.status).toBe(200);

    const putRes = await putTruth(
      new Request('http://localhost/truth-pack', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          facts: [{ key: 'brand', value: 'Nope', status: 'EXTRACTED' }],
        }),
      }),
      ctx(workspaceId, projectId),
    );
    expect(putRes.status).toBe(403);
    const putBody = await putRes.json();
    expect(putBody.error.code).toBe('FORBIDDEN');

    const extractRes = await postExtract(
      new Request('http://localhost/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetVersionIds: [] }),
      }),
      ctx(workspaceId, projectId),
    );
    expect(extractRes.status).toBe(403);

    const confirmRes = await postConfirm(
      new Request('http://localhost/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          updates: [{ factId: revision.facts[0]!.id, status: 'LOCKED' }],
        }),
      }),
      ctx(workspaceId, projectId),
    );
    expect(confirmRes.status).toBe(403);

    const approveRes = await postApprove(
      new Request('http://localhost/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revisionId: revision.id }),
      }),
      ctx(workspaceId, projectId),
    );
    expect(approveRes.status).toBe(200);
    const approved = await truth.getRevisionWithDetails(workspaceId, revision.id);
    expect(approved?.status).toBe('APPROVED');
  });

  it('API: MEMBER may PUT/confirm but is denied approve', async () => {
    const { owner, member, project } = await seedWorkspace();
    const workspaceId = owner.workspace.id;
    const projectId = project.id;

    asSession(member.user.id, member.user.email);

    const putRes = await putTruth(
      new Request('http://localhost/truth-pack', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          facts: [{ key: 'color', value: 'blue', status: 'CONFIRMED' }],
        }),
      }),
      ctx(workspaceId, projectId),
    );
    expect(putRes.status).toBe(200);
    const putJson = await putRes.json();
    const revisionId = putJson.revision?.id ?? putJson.currentRevisionId;
    expect(revisionId).toBeTruthy();

    const doc = await truth.getDocument(workspaceId, projectId);
    const rev = await truth.getRevisionWithDetails(workspaceId, doc!.currentRevisionId!);
    await truth.setRevisionStatus(workspaceId, rev!.id, 'PENDING_REVIEW');

    const approveRes = await postApprove(
      new Request('http://localhost/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revisionId: rev!.id }),
      }),
      ctx(workspaceId, projectId),
    );
    expect(approveRes.status).toBe(403);
    const body = await approveRes.json();
    expect(JSON.stringify(body)).toMatch(/FORBIDDEN|Role MEMBER/i);

    const still = await truth.getRevisionWithDetails(workspaceId, rev!.id);
    expect(still?.status).toBe('PENDING_REVIEW');
  });

  it('API: OWNER passes role gate on extract (validation 400 for empty assetVersionIds, not 403)', async () => {
    const { owner, project } = await seedWorkspace();
    asSession(owner.user.id, owner.user.email);
    const extractRes = await postExtract(
      new Request('http://localhost/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetVersionIds: [] }),
      }),
      ctx(owner.workspace.id, project.id),
    );
    expect(extractRes.status).toBe(400);
    const body = await extractRes.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
