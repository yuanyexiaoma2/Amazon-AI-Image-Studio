import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  ProjectRepository,
  UserRepository,
  WorkflowRepository,
  CreditRepository,
  GenerationRepository,
  newId,
} from '../../src/index.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('W4 generation + credits integration', () => {
  const db = new PrismaClient();
  const users = new UserRepository(db);
  const projects = new ProjectRepository(db);
  const workflows = new WorkflowRepository(db);
  const credits = new CreditRepository(db);
  const gen = new GenerationRepository(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('reserve append-only; run creates outbox with stable jobId', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `w4-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `W4-${suffix}`,
      name: 'W4 Project',
    });

    await credits.grant(workspace.id, 5_000_000, `grant-${workspace.id}`);
    const before = await credits.getBalances(workspace.id);
    expect(before.availableMicrounits).toBe(5_000_000);

    const wf = await workflows.createWithGraph({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'w4-run',
      createdByUserId: user.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: 'g1',
            type: 'generate',
            position: { x: 0, y: 0 },
            config: { schemaVersion: 1, prompt: 'test product' },
          },
        ],
        edges: [],
      },
    });
    const { revision } = await workflows.snapshot({
      workspaceId: workspace.id,
      workflowId: wf.id,
      ifRevision: 1,
      createdByUserId: user.id,
    });

    const { run: runRow, outboxRows, created } = await gen.createRun({
      workspaceId: workspace.id,
      workflowRevisionId: revision.id,
      requestedByUserId: user.id,
      idempotencyKey: newId(),
      confirmBudget: true,
      budgetLimit: { currency: 'USD', amount: 1 },
      scenario: 'SUCCESS',
    });
    expect(created).toBe(true);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.jobId.startsWith('gen-attempt-')).toBe(true);
    expect(runRow.items).toHaveLength(1);

    const mid = await credits.getBalances(workspace.id);
    expect(mid.heldMicrounits).toBeGreaterThan(0);
    expect(mid.availableMicrounits).toBeLessThan(before.availableMicrounits);

    const events = await credits.listEvents(workspace.id, 20);
    expect(events.some((e) => e.type === 'GRANT')).toBe(true);
    expect(events.some((e) => e.type === 'RESERVE')).toBe(true);
  });
});
