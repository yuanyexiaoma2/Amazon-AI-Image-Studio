import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { emptyWorkflowGraph, validateWorkflowGraph } from '@studio/domain';
import {
  ProjectRepository,
  UserRepository,
  WorkflowConflictError,
  WorkflowRepository,
  WorkflowValidationError,
  newId,
} from '../../src/index.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('Workflow draft optimistic lock (W3-B1)', () => {
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
      email: `wf-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `WF-${suffix}`,
      name: 'Workflow Project',
    });
    return { user, workspace, project };
  }

  it('creates empty workflow and saves draft advancing revisionNumber', async () => {
    const { user, workspace, project } = await seed();
    const created = await workflows.createEmpty({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'Empty',
      createdByUserId: user.id,
    });
    expect(created.draft?.revisionNumber).toBe(0);
    expect(workflows.parseGraph(created.draft!).nodes).toEqual([]);

    const saved = await workflows.saveDraft({
      workspaceId: workspace.id,
      workflowId: created.id,
      ifRevision: 0,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: 'n1',
            type: 'source_image',
            position: { x: 10, y: 20 },
            config: { schemaVersion: 1 },
          },
        ],
        edges: [],
      },
      updatedByUserId: user.id,
    });
    expect(saved.draft?.revisionNumber).toBe(1);
    expect(workflows.parseGraph(saved.draft!).nodes[0]?.position).toEqual({ x: 10, y: 20 });
  });

  it('returns 409-style conflict when ifRevision is stale (no silent overwrite)', async () => {
    const { user, workspace, project } = await seed();
    const created = await workflows.createEmpty({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'Conflict',
      createdByUserId: user.id,
    });

    await workflows.saveDraft({
      workspaceId: workspace.id,
      workflowId: created.id,
      ifRevision: 0,
      graph: emptyWorkflowGraph(),
      updatedByUserId: user.id,
    });

    await expect(
      workflows.saveDraft({
        workspaceId: workspace.id,
        workflowId: created.id,
        ifRevision: 0,
        graph: {
          schemaVersion: 1,
          nodes: [{ id: 'stale', type: 'prompt', position: { x: 0, y: 0 }, config: {} }],
          edges: [],
        },
        updatedByUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(WorkflowConflictError);

    const fresh = await workflows.getWithDraft(workspace.id, created.id);
    expect(fresh?.draft?.revisionNumber).toBe(1);
    expect(workflows.parseGraph(fresh!.draft!).nodes).toEqual([]);
  });

  it('rejects cyclic graphs on save', async () => {
    const { user, workspace, project } = await seed();
    const created = await workflows.createEmpty({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'Cycle',
      createdByUserId: user.id,
    });
    const cyclic = {
      schemaVersion: 1 as const,
      nodes: [
        { id: 'a', type: 'upscale', position: { x: 0, y: 0 }, config: { schemaVersion: 1 } },
        { id: 'b', type: 'upscale', position: { x: 100, y: 0 }, config: { schemaVersion: 1 } },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', sourceHandle: 'image', targetHandle: 'image' },
        { id: 'e2', source: 'b', target: 'a', sourceHandle: 'image', targetHandle: 'image' },
      ],
    };
    expect(validateWorkflowGraph(cyclic).ok).toBe(false);
    await expect(
      workflows.saveDraft({
        workspaceId: workspace.id,
        workflowId: created.id,
        ifRevision: 0,
        graph: cyclic,
        updatedByUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(WorkflowValidationError);
  });

  it('snapshot creates immutable revision and advances currentRevisionId', async () => {
    const { user, workspace, project } = await seed();
    const created = await workflows.createEmpty({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'Snap',
      createdByUserId: user.id,
    });
    await workflows.saveDraft({
      workspaceId: workspace.id,
      workflowId: created.id,
      ifRevision: 0,
      graph: emptyWorkflowGraph(),
      updatedByUserId: user.id,
    });
    const { workflow, revision } = await workflows.snapshot({
      workspaceId: workspace.id,
      workflowId: created.id,
      ifRevision: 1,
      createdByUserId: user.id,
    });
    expect(revision.revision).toBe(1);
    expect(workflow.currentRevisionId).toBe(revision.id);
  });
});
