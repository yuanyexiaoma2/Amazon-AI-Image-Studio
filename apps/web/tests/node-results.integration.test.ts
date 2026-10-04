/**
 * Route-level tests for GET .../workflows/{wf}/node-results — the canvas
 * generate-node thumbnail feed. Runs only with RUN_INTEGRATION=1 (real
 * Postgres), same gate as other route tests.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();

vi.mock('../lib/auth', () => ({
  auth: () => authMock(),
}));

import {
  prisma,
  NodeResultRepository,
  ProjectRepository,
  UserRepository,
  WorkflowRepository,
  newId,
} from '@studio/db';
import { GET as getNodeResults } from '../app/api/workspaces/[workspaceId]/workflows/[workflowId]/node-results/route';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

function ctx(workspaceId: string, workflowId: string) {
  return { params: Promise.resolve({ workspaceId, workflowId }) };
}

function get(url: string) {
  return new Request(`http://localhost${url}`, { method: 'GET' });
}

function asSession(userId: string, email: string, sessionVersion = 0) {
  authMock.mockResolvedValue({
    user: { id: userId, email },
    sessionVersion,
  });
}

describe.skipIf(!run)('Node results API (real route handler)', () => {
  const users = new UserRepository(prisma);
  const projects = new ProjectRepository(prisma);
  const workflows = new WorkflowRepository(prisma);
  const nodeResults = new NodeResultRepository(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  async function seed() {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const owner = await users.createWithDefaultWorkspace({
      email: `nr-owner-${suffix}@example.com`,
      passwordHash: 'hash',
      workspaceName: `NR-WS-${suffix}`,
    });
    const project = await projects.create({
      workspaceId: owner.workspace.id,
      sku: `NRSKU-${suffix}`,
      name: 'Node Results',
    });
    const workflow = await workflows.createEmpty({
      workspaceId: owner.workspace.id,
      projectId: project.id,
      name: 'Canvas',
      createdByUserId: owner.user.id,
    });
    return { owner, workflow };
  }

  it('returns {} before any snapshot, then maps SUCCEEDED results per node', async () => {
    const { owner, workflow } = await seed();
    const workspaceId = owner.workspace.id;
    const workflowId = workflow.id;
    asSession(owner.user.id, owner.user.email);

    // No snapshot yet → no currentRevisionId → empty envelope.
    const empty = await getNodeResults(get('/node-results'), ctx(workspaceId, workflowId));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ results: {}, stale: {} });

    const { revision } = await workflows.snapshot({
      workspaceId,
      workflowId,
      ifRevision: 0,
      createdByUserId: owner.user.id,
    });

    const v1 = newId();
    const v2 = newId();
    await nodeResults.upsert({
      workspaceId,
      projectId: workflow.projectId,
      workflowRevisionId: revision.id,
      nodeId: 'n-gen-1',
      status: 'SUCCEEDED',
      outputJson: { imageAssetVersionIds: [v1, v2], maskAssetVersionId: null },
      lastAttemptId: null,
    });
    // STALE row keeps its old outputJson but must not be exposed.
    await nodeResults.upsert({
      workspaceId,
      projectId: workflow.projectId,
      workflowRevisionId: revision.id,
      nodeId: 'n-gen-2',
      status: 'STALE',
      outputJson: { imageAssetVersionIds: [newId()] },
      lastAttemptId: null,
    });
    // SUCCEEDED with no images (mask-only) must not appear either.
    await nodeResults.upsert({
      workspaceId,
      projectId: workflow.projectId,
      workflowRevisionId: revision.id,
      nodeId: 'n-rmbg-1',
      status: 'SUCCEEDED',
      outputJson: { imageAssetVersionIds: [], maskAssetVersionId: newId() },
      lastAttemptId: null,
    });

    // Default: resolves the workflow's currentRevisionId.
    const res = await getNodeResults(get('/node-results'), ctx(workspaceId, workflowId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Record<string, string[]>;
      stale: Record<string, boolean>;
    };
    expect(body.results).toEqual({ 'n-gen-1': [v1, v2] });
    // 两个 SUCCEEDED 节点都不在 draft（空画布）里 → stale: true。
    expect(body.stale).toEqual({ 'n-gen-1': true, 'n-rmbg-1': true });

    // Explicit revisionId param yields the same envelope.
    const byRevision = await getNodeResults(
      get(`/node-results?revisionId=${revision.id}`),
      ctx(workspaceId, workflowId),
    );
    expect(byRevision.status).toBe(200);
    const byRevisionBody = (await byRevision.json()) as {
      results: Record<string, string[]>;
      stale: Record<string, boolean>;
    };
    expect(byRevisionBody.results).toEqual({ 'n-gen-1': [v1, v2] });

    // Unknown / cross-workflow revisionId → 404.
    const missing = await getNodeResults(
      get(`/node-results?revisionId=${newId()}`),
      ctx(workspaceId, workflowId),
    );
    expect(missing.status).toBe(404);
  });

  it('rejects unauthenticated and cross-workspace access', async () => {
    const { owner, workflow } = await seed();
    asSession(owner.user.id, owner.user.email);

    // A second user in another workspace must not read these results.
    const stranger = await users.createWithDefaultWorkspace({
      email: `nr-stranger-${newId().slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      workspaceName: `NR-WS-stranger-${newId().slice(0, 8)}`,
    });
    asSession(stranger.user.id, stranger.user.email);
    const forbidden = await getNodeResults(
      get('/node-results'),
      ctx(owner.workspace.id, workflow.id),
    );
    expect(forbidden.status).toBe(403);
  });
});
