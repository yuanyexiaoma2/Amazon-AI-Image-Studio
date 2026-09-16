/**
 * PR-6 — LOCAL_MODE integration (real Postgres, RUN_INTEGRATION=1):
 * - GET /api/me works without any Auth.js session (local principal)
 * - `authenticated` flag reflects whether a real session exists
 * - canvas structure commands are free; a trailing `run` command is a paid
 *   action and returns 401 UNAUTHENTICATED until a real session exists.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();

vi.mock('../lib/auth', () => ({
  auth: () => authMock(),
}));

import { newId, prisma, WorkflowRepository } from '@studio/db';
import { ensureLocalPrincipal } from '../lib/local-principal';
import { GET as getMe } from '../app/api/me/route';
import { POST as postCommands } from '../app/api/workspaces/[workspaceId]/workflows/[workflowId]/commands/route';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

function ctx(workspaceId: string, workflowId: string) {
  return { params: Promise.resolve({ workspaceId, workflowId }) };
}

function post(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!run)('LOCAL_MODE two-tier access (real route handlers)', () => {
  const prevLocalMode = process.env.LOCAL_MODE;

  beforeEach(() => {
    process.env.LOCAL_MODE = '1';
    authMock.mockReset();
  });

  afterAll(async () => {
    if (prevLocalMode === undefined) delete process.env.LOCAL_MODE;
    else process.env.LOCAL_MODE = prevLocalMode;
    await prisma.$disconnect();
  });

  it('GET /api/me returns the local principal without any session', async () => {
    authMock.mockResolvedValue(null);
    const res = await getMe(new Request('http://localhost/api/me'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe('local@studio.local');
    expect(body.localMode).toBe(true);
    expect(body.authenticated).toBe(false);
    expect(body.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(body.workspaces[0].role).toBe('OWNER');
    expect(body.workspaces[0].autoApproveGates).toBe(true);
  });

  it('/api/me authenticated=true once a real session exists', async () => {
    const { user } = await ensureLocalPrincipal();
    authMock.mockResolvedValue({
      user: { id: user.id, email: user.email },
      sessionVersion: user.sessionVersion,
    });
    const res = await getMe(new Request('http://localhost/api/me'));
    expect(res.status).toBe(200);
    expect((await res.json()).authenticated).toBe(true);
  });

  it('graph commands are free without login; run command is gated (401)', async () => {
    authMock.mockResolvedValue(null);
    const { user, workspace, project } = await ensureLocalPrincipal();
    const workflows = new WorkflowRepository(prisma);
    const wf = await workflows.createEmpty({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'LOCAL_MODE 测试画布',
      createdByUserId: user.id,
    });

    // Free: add a node with no session.
    const addRes = await postCommands(
      post('/commands', {
        ifRevision: 0,
        batchId: newId(),
        commands: [{ type: 'addNode', nodeType: 'prompt', position: { x: 0, y: 0 } }],
      }),
      ctx(workspace.id, wf.id),
    );
    expect(addRes.status).toBe(200);

    // Paid: trailing run command without a real session → 401.
    const runRes = await postCommands(
      post('/commands', {
        ifRevision: 1,
        batchId: newId(),
        commands: [
          { type: 'run', scope: { type: 'ALL' }, idempotencyKey: `local-run-${newId()}` },
        ],
      }),
      ctx(workspace.id, wf.id),
    );
    expect(runRes.status).toBe(401);
    expect((await runRes.json()).error.code).toBe('UNAUTHENTICATED');
  });
});
