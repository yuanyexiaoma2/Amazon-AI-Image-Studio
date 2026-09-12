import { describe, expect, it, beforeAll } from 'vitest';
import { prisma, newId, NodeResultRepository } from '../../src/index.js';
import {
  computeInputFingerprint,
  propagateStaleFromTruthChange,
  type WorkflowGraph,
} from '@studio/domain';

const run = process.env.RUN_INTEGRATION === '1' || process.env.DATABASE_URL?.includes('localhost');

describe.skipIf(!run)('W5-A fingerprint + STALE persistence', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  it('stores NodeResult SUCCEEDED then marks STALE on truth propagation', async () => {
    const workspaceId = newId();
    const projectId = newId();
    const userId = newId();
    await prisma.user.create({
      data: {
        id: userId,
        email: `w5a-${userId}@example.com`,
        name: 'W5A',
        passwordHash: 'x',
      },
    });
    await prisma.workspace.create({
      data: { id: workspaceId, name: 'W5A', ownerUserId: userId },
    });
    await prisma.project.create({
      data: { id: projectId, workspaceId, sku: `SKU-${userId.slice(0, 6)}`, name: 'P' },
    });
    const workflowId = newId();
    await prisma.workflow.create({
      data: {
        id: workflowId,
        workspaceId,
        projectId,
        name: 'w5',
      },
    });
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'truth',
          type: 'product_truth',
          position: { x: 0, y: 0 },
          config: { truthRevisionId: newId() },
        },
        {
          id: 'gen',
          type: 'generate',
          position: { x: 0, y: 0 },
          config: { schemaVersion: 1, modelKey: 'primary-image-edit' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'truth',
          target: 'gen',
          sourceHandle: 'truth',
          targetHandle: 'truth',
        },
      ],
    };
    const revisionId = newId();
    await prisma.workflowRevision.create({
      data: {
        id: revisionId,
        workspaceId,
        workflowId,
        revision: 1,
        graphJson: graph as object,
        createdByUserId: userId,
      },
    });

    const fp = computeInputFingerprint({
      nodeType: 'generate',
      nodeConfig: { schemaVersion: 1, modelKey: 'primary-image-edit' },
      modelRegistryConfigVersion: 1,
      prompt: 'x',
      truthRevisionId: null,
    });

    const nr = new NodeResultRepository(prisma);
    await nr.upsert({
      workspaceId,
      projectId,
      workflowRevisionId: revisionId,
      nodeId: 'gen',
      status: 'SUCCEEDED',
      inputFingerprint: fp.sha256,
      outputJson: { imageAssetVersionIds: [] },
    });

    const ev = propagateStaleFromTruthChange(graph);
    const n = await nr.applyStaleEvent(workspaceId, projectId, revisionId, ev);
    expect(n).toBeGreaterThan(0);
    const row = await nr.get(workspaceId, revisionId, 'gen');
    expect(row?.status).toBe('STALE');
    expect(row?.inputFingerprint).toBe(fp.sha256);
  });
});
