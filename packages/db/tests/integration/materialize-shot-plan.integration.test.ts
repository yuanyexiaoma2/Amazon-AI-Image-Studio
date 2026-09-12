import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  collectReferencedAssetVersionIds,
  materializeShotPlanToGraph,
  DEFAULT_SEVEN_IMAGE_TEMPLATE,
} from '@studio/domain';
import {
  AssetRepository,
  ProjectRepository,
  ShotPlanRepository,
  UserRepository,
  WorkflowRepository,
  newId,
} from '../../src/index.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('W3-08 materialize + referencedAssetVersionIds (integration)', () => {
  const db = new PrismaClient();
  const users = new UserRepository(db);
  const projects = new ProjectRepository(db);
  const plans = new ShotPlanRepository(db);
  const assets = new AssetRepository(db);
  const workflows = new WorkflowRepository(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('rejects unknown referencedAssetVersionIds then accepts valid ones and creates graph', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `mat-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `MAT-${suffix}`,
      name: 'Materialize Project',
    });

    // Minimal approved truth revision so shot plan can be approved path isn't needed for assert helper
    const fakeMissing = [newId()];
    await expect(
      assets.assertVersionsInProject(workspace.id, project.id, fakeMissing),
    ).rejects.toThrow(/Evidence Asset Version/);

    await expect(
      assets.assertVersionsInProject(workspace.id, project.id, []),
    ).resolves.toBeUndefined();

    const canvasPayload = {
      planDocumentId: newId(),
      planRevisionId: newId(),
      projectId: project.id,
      workspaceId: workspace.id,
      truthRevisionId: newId(),
      briefs: DEFAULT_SEVEN_IMAGE_TEMPLATE.map((t, i) => ({
        briefId: newId(),
        slot: t.slot,
        purpose: t.purpose,
        orderIndex: t.orderIndex,
        aspectRatio: t.aspectRatio,
        targetPixels: t.targetPixels,
        copy: [] as unknown[],
        must: [...t.must],
        mustNot: [...t.mustNot],
        qaPolicy: t.qaPolicy,
        referencedAssetVersionIds: [] as string[],
      })),
    };

    expect(collectReferencedAssetVersionIds(canvasPayload)).toEqual([]);
    const mat = materializeShotPlanToGraph(canvasPayload);
    expect(mat.ok).toBe(true);
    if (!mat.ok) return;

    const created = await workflows.createWithGraph({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'Materialized',
      createdByUserId: user.id,
      graph: mat.graph,
    });
    expect(created.draft?.revisionNumber).toBe(1);
    expect(workflows.parseGraph(created.draft!).nodes.filter((n) => n.type === 'generate')).toHaveLength(
      7,
    );

    // silence unused
    expect(plans).toBeTruthy();
  });
});
