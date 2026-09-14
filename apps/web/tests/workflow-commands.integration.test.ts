/**
 * Route-level tests for the V2 PR-2 canvas command API:
 * POST commands (apply + batchId replay) / commands/undo / commands/redo.
 * Runs only with RUN_INTEGRATION=1 (real Postgres), same gate as other route tests.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();

vi.mock('../lib/auth', () => ({
  auth: () => authMock(),
}));

import {
  prisma,
  ProjectRepository,
  UserRepository,
  WorkflowRepository,
  newId,
} from '@studio/db';
import { POST as postCommands } from '../app/api/workspaces/[workspaceId]/workflows/[workflowId]/commands/route';
import { POST as postUndo } from '../app/api/workspaces/[workspaceId]/workflows/[workflowId]/commands/undo/route';
import { POST as postRedo } from '../app/api/workspaces/[workspaceId]/workflows/[workflowId]/commands/redo/route';

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

function asSession(userId: string, email: string, sessionVersion = 0) {
  authMock.mockResolvedValue({
    user: { id: userId, email },
    sessionVersion,
  });
}

describe.skipIf(!run)('Workflow command API (real route handlers)', () => {
  const users = new UserRepository(prisma);
  const projects = new ProjectRepository(prisma);
  const workflows = new WorkflowRepository(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  async function seed() {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const owner = await users.createWithDefaultWorkspace({
      email: `wfc-owner-${suffix}@example.com`,
      passwordHash: 'hash',
      workspaceName: `WFC-WS-${suffix}`,
    });
    const project = await projects.create({
      workspaceId: owner.workspace.id,
      sku: `WFSKU-${suffix}`,
      name: 'Workflow Commands',
    });
    const workflow = await workflows.createEmpty({
      workspaceId: owner.workspace.id,
      projectId: project.id,
      name: 'Canvas',
      createdByUserId: owner.user.id,
    });
    return { owner, workflow };
  }

  it('applies a command batch, replays batchId idempotently, then undo/redo', async () => {
    const { owner, workflow } = await seed();
    const workspaceId = owner.workspace.id;
    const workflowId = workflow.id;
    asSession(owner.user.id, owner.user.email);

    const batchId = newId();
    const payload = {
      ifRevision: 0,
      batchId,
      commands: [
        { type: 'addNode', nodeType: 'prompt', nodeId: 'n-prompt-1', position: { x: 10, y: 20 } },
        { type: 'rename', name: 'My Canvas' },
      ],
    };

    const applied = await postCommands(post('/commands', payload), ctx(workspaceId, workflowId));
    expect(applied.status).toBe(200);
    const appliedJson = await applied.json();
    expect(appliedJson.batchId).toBe(batchId);
    expect(appliedJson.revisionNumber).toBe(1);
    expect(appliedJson.name).toBe('My Canvas');
    expect(appliedJson.graph.nodes).toHaveLength(1);
    expect(appliedJson.graph.nodes[0].id).toBe('n-prompt-1');
    expect(appliedJson.run).toBeUndefined();

    // Idempotent replay: same batchId must not re-apply commands (no duplicate node).
    const replayed = await postCommands(post('/commands', payload), ctx(workspaceId, workflowId));
    expect(replayed.status).toBe(200);
    const replayedJson = await replayed.json();
    expect(replayedJson.batchId).toBe(batchId);
    expect(replayedJson.revisionNumber).toBe(1);
    expect(replayedJson.graph.nodes).toHaveLength(1);

    // Undo rolls the draft back to the batch's beforeGraph.
    const undone = await postUndo(
      post('/commands/undo', { ifRevision: 1, batchId }),
      ctx(workspaceId, workflowId),
    );
    expect(undone.status).toBe(200);
    const undoneJson = await undone.json();
    expect(undoneJson.revisionNumber).toBe(2);
    expect(undoneJson.graph.nodes).toHaveLength(0);

    // Undoing the same batch again conflicts.
    const undoneAgain = await postUndo(
      post('/commands/undo', { ifRevision: 2, batchId }),
      ctx(workspaceId, workflowId),
    );
    expect(undoneAgain.status).toBe(409);
    const undoneAgainJson = await undoneAgain.json();
    expect(undoneAgainJson.error.code).toBe('WORKFLOW_UNDO_CONFLICT');
    expect(undoneAgainJson.error.details.reason).toBe('ALREADY_UNDONE');

    // Redo re-applies the batch's afterGraph.
    const redone = await postRedo(
      post('/commands/redo', { ifRevision: 2, batchId }),
      ctx(workspaceId, workflowId),
    );
    expect(redone.status).toBe(200);
    const redoneJson = await redone.json();
    expect(redoneJson.revisionNumber).toBe(3);
    expect(redoneJson.graph.nodes).toHaveLength(1);
    expect(redoneJson.graph.nodes[0].id).toBe('n-prompt-1');
  });

  it('rejects stale ifRevision with 409 and invalid commands with 400', async () => {
    const { owner, workflow } = await seed();
    const workspaceId = owner.workspace.id;
    const workflowId = workflow.id;
    asSession(owner.user.id, owner.user.email);

    const stale = await postCommands(
      post('/commands', {
        ifRevision: 7,
        batchId: newId(),
        commands: [
          { type: 'addNode', nodeType: 'prompt', position: { x: 0, y: 0 } },
        ],
      }),
      ctx(workspaceId, workflowId),
    );
    expect(stale.status).toBe(409);
    const staleJson = await stale.json();
    expect(staleJson.error.code).toBe('WORKFLOW_REVISION_CONFLICT');

    const invalid = await postCommands(
      post('/commands', {
        ifRevision: 0,
        batchId: newId(),
        commands: [
          { type: 'addNode', nodeType: 'nope_not_a_node', position: { x: 0, y: 0 } },
        ],
      }),
      ctx(workspaceId, workflowId),
    );
    expect(invalid.status).toBe(400);
    const invalidJson = await invalid.json();
    expect(invalidJson.error.code).toBe('VALIDATION_ERROR');
    expect(invalidJson.error.details.code).toBe('UNKNOWN_NODE_TYPE');
    expect(invalidJson.error.details.commandIndex).toBe(0);
  });
});
