import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { emptyWorkflowGraph, type WorkflowGraph } from '@studio/domain';
import {
  ProjectRepository,
  UserRepository,
  WorkflowConflictError,
  WorkflowRepository,
  WorkflowUndoError,
  newId,
} from '../../src/index.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

function graphWithNode(id: string): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [{ id, type: 'source_image', position: { x: 10, y: 20 }, config: { schemaVersion: 1 } }],
    edges: [],
  };
}

describe.skipIf(!run)('Workflow command batches (V2 PR-2)', () => {
  const db = new PrismaClient();
  const users = new UserRepository(db);
  const projects = new ProjectRepository(db);
  const workflows = new WorkflowRepository(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  async function seed() {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `wfcmd-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `WFCMD-${suffix}`,
      name: 'Command Project',
    });
    const workflow = await workflows.createEmpty({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'Commands',
      createdByUserId: user.id,
    });
    return { user, workspace, workflow };
  }

  async function batchCount(workflowId: string) {
    return db.workflowCommandBatch.count({ where: { workflowId } });
  }

  it('applies a command batch: draft advances, batch row persisted with base/result revisions', async () => {
    const { user, workspace, workflow } = await seed();
    const beforeGraph = emptyWorkflowGraph();
    const afterGraph = graphWithNode('n1');
    const batchId = newId();

    const result = await workflows.applyCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 0,
      batchId,
      actorUserId: user.id,
      commands: [{ type: 'addNode', nodeType: 'source_image', position: { x: 10, y: 20 } }],
      beforeGraph,
      afterGraph,
    });

    expect(result.replayed).toBe(false);
    expect(result.draft.draft?.revisionNumber).toBe(1);
    expect(workflows.parseGraph(result.draft.draft!).nodes[0]?.id).toBe('n1');
    expect(result.batch.batchId).toBe(batchId);
    expect(result.batch.actorUserId).toBe(user.id);
    expect(result.batch.baseRevisionNumber).toBe(0);
    expect(result.batch.resultRevisionNumber).toBe(1);
    expect(result.batch.undoneAt).toBeNull();
    expect(workflows.parseGraphJson(result.batch.beforeGraphJson).nodes).toEqual([]);
    expect(workflows.parseGraphJson(result.batch.afterGraphJson).nodes[0]?.id).toBe('n1');
    expect(await batchCount(workflow.id)).toBe(1);
  });

  it('is idempotent on batchId: replay returns existing batch without advancing the draft', async () => {
    const { user, workspace, workflow } = await seed();
    const args = {
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 0,
      batchId: newId(),
      actorUserId: user.id,
      commands: [{ type: 'addNode', nodeType: 'source_image', position: { x: 0, y: 0 } }],
      beforeGraph: emptyWorkflowGraph(),
      afterGraph: graphWithNode('n1'),
    };

    const first = await workflows.applyCommandBatch(args);
    expect(first.replayed).toBe(false);

    // Replay with the same (now stale) ifRevision — must short-circuit before the conditional update.
    const replay = await workflows.applyCommandBatch(args);
    expect(replay.replayed).toBe(true);
    expect(replay.batch.id).toBe(first.batch.id);
    expect(replay.draft.draft?.revisionNumber).toBe(1);
    expect(await batchCount(workflow.id)).toBe(1);
  });

  it('rejects stale ifRevision with WorkflowConflictError and writes no batch row', async () => {
    const { user, workspace, workflow } = await seed();
    await workflows.applyCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 0,
      batchId: newId(),
      actorUserId: user.id,
      commands: [{ type: 'rename', name: 'x' }],
      beforeGraph: emptyWorkflowGraph(),
      afterGraph: emptyWorkflowGraph(),
    });

    await expect(
      workflows.applyCommandBatch({
        workspaceId: workspace.id,
        workflowId: workflow.id,
        ifRevision: 0,
        batchId: newId(),
        actorUserId: user.id,
        commands: [{ type: 'addNode', nodeType: 'prompt', position: { x: 0, y: 0 } }],
        beforeGraph: emptyWorkflowGraph(),
        afterGraph: graphWithNode('stale'),
      }),
    ).rejects.toBeInstanceOf(WorkflowConflictError);

    expect(await batchCount(workflow.id)).toBe(1);
    const fresh = await workflows.getWithDraft(workspace.id, workflow.id);
    expect(fresh?.draft?.revisionNumber).toBe(1);
    expect(workflows.parseGraph(fresh!.draft!).nodes).toEqual([]);
  });

  it('undo restores beforeGraph and sets undoneAt; redo restores afterGraph and clears it', async () => {
    const { user, workspace, workflow } = await seed();
    const beforeGraph = emptyWorkflowGraph();
    const afterGraph = graphWithNode('n1');
    const batchId = newId();
    await workflows.applyCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 0,
      batchId,
      actorUserId: user.id,
      commands: [{ type: 'addNode', nodeType: 'source_image', position: { x: 10, y: 20 } }],
      beforeGraph,
      afterGraph,
    });

    const undone = await workflows.undoCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 1,
      batchId,
    });
    expect(undone.batch.undoneAt).not.toBeNull();
    expect(undone.draft.draft?.revisionNumber).toBe(2);
    expect(workflows.parseGraph(undone.draft.draft!).nodes).toEqual([]);

    // Undoing an already-undone batch fails.
    await expect(
      workflows.undoCommandBatch({
        workspaceId: workspace.id,
        workflowId: workflow.id,
        ifRevision: 2,
        batchId,
      }),
    ).rejects.toBeInstanceOf(WorkflowUndoError);
    await expect(
      workflows.undoCommandBatch({
        workspaceId: workspace.id,
        workflowId: workflow.id,
        ifRevision: 2,
        batchId,
      }),
    ).rejects.toMatchObject({ reason: 'ALREADY_UNDONE' });

    const redone = await workflows.redoCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 2,
      batchId,
    });
    expect(redone.batch.undoneAt).toBeNull();
    expect(redone.draft.draft?.revisionNumber).toBe(3);
    expect(workflows.parseGraph(redone.draft.draft!).nodes[0]?.id).toBe('n1');

    // Redoing a non-undone batch fails.
    await expect(
      workflows.redoCommandBatch({
        workspaceId: workspace.id,
        workflowId: workflow.id,
        ifRevision: 3,
        batchId,
      }),
    ).rejects.toMatchObject({ reason: 'NOT_UNDONE' });
  });

  it('undo/redo without batchId target the most recent matching batch; nothing-to-undo errors', async () => {
    const { user, workspace, workflow } = await seed();

    // Nothing applied yet → undo fails.
    await expect(
      workflows.undoCommandBatch({
        workspaceId: workspace.id,
        workflowId: workflow.id,
        ifRevision: 0,
      }),
    ).rejects.toMatchObject({ reason: 'NOTHING_TO_UNDO' });

    const batchA = newId();
    const batchB = newId();
    await workflows.applyCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 0,
      batchId: batchA,
      actorUserId: user.id,
      commands: [{ type: 'addNode', nodeType: 'source_image', position: { x: 0, y: 0 } }],
      beforeGraph: emptyWorkflowGraph(),
      afterGraph: graphWithNode('a'),
    });
    await workflows.applyCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 1,
      batchId: batchB,
      actorUserId: user.id,
      commands: [{ type: 'addNode', nodeType: 'source_image', position: { x: 100, y: 0 } }],
      beforeGraph: graphWithNode('a'),
      afterGraph: {
        schemaVersion: 1,
        nodes: [
          { id: 'a', type: 'source_image', position: { x: 0, y: 0 }, config: { schemaVersion: 1 } },
          { id: 'b', type: 'source_image', position: { x: 100, y: 0 }, config: { schemaVersion: 1 } },
        ],
        edges: [],
      },
    });

    // Default undo picks the most recent non-undone batch (B).
    const undoB = await workflows.undoCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 2,
    });
    expect(undoB.batch.batchId).toBe(batchB);
    expect(undoB.draft.draft?.revisionNumber).toBe(3);
    expect(workflows.parseGraph(undoB.draft.draft!).nodes.map((n) => n.id)).toEqual(['a']);

    // Next default undo picks batch A.
    const undoA = await workflows.undoCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 3,
    });
    expect(undoA.batch.batchId).toBe(batchA);
    expect(undoA.draft.draft?.revisionNumber).toBe(4);
    expect(workflows.parseGraph(undoA.draft.draft!).nodes).toEqual([]);

    // Both undone → nothing left to undo.
    await expect(
      workflows.undoCommandBatch({
        workspaceId: workspace.id,
        workflowId: workflow.id,
        ifRevision: 4,
      }),
    ).rejects.toMatchObject({ reason: 'NOTHING_TO_UNDO' });

    // Redo by explicit batchId in original order: A then B.
    const redoA = await workflows.redoCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 4,
      batchId: batchA,
    });
    expect(redoA.batch.undoneAt).toBeNull();
    expect(redoA.draft.draft?.revisionNumber).toBe(5);
    const redoB = await workflows.redoCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 5,
      batchId: batchB,
    });
    expect(redoB.draft.draft?.revisionNumber).toBe(6);
    expect(workflows.parseGraph(redoB.draft.draft!).nodes.map((n) => n.id)).toEqual(['a', 'b']);

    // Nothing undone left → default redo fails.
    await expect(
      workflows.redoCommandBatch({
        workspaceId: workspace.id,
        workflowId: workflow.id,
        ifRevision: 6,
      }),
    ).rejects.toMatchObject({ reason: 'NOTHING_TO_REDO' });
  });

  it('undo with stale ifRevision raises WorkflowConflictError and leaves the batch untouched', async () => {
    const { user, workspace, workflow } = await seed();
    const batchId = newId();
    await workflows.applyCommandBatch({
      workspaceId: workspace.id,
      workflowId: workflow.id,
      ifRevision: 0,
      batchId,
      actorUserId: user.id,
      commands: [{ type: 'addNode', nodeType: 'source_image', position: { x: 0, y: 0 } }],
      beforeGraph: emptyWorkflowGraph(),
      afterGraph: graphWithNode('n1'),
    });

    await expect(
      workflows.undoCommandBatch({
        workspaceId: workspace.id,
        workflowId: workflow.id,
        ifRevision: 0,
        batchId,
      }),
    ).rejects.toBeInstanceOf(WorkflowConflictError);

    const fresh = await workflows.getWithDraft(workspace.id, workflow.id);
    expect(fresh?.draft?.revisionNumber).toBe(1);
    expect(workflows.parseGraph(fresh!.draft!).nodes[0]?.id).toBe('n1');
    const batch = await db.workflowCommandBatch.findFirst({ where: { workflowId: workflow.id } });
    expect(batch?.undoneAt).toBeNull();
  });
});
