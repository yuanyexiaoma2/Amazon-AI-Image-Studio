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

  it('concurrent RESERVE serializes: balances match ledger (no lost update)', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { workspace } = await users.createWithDefaultWorkspace({
      email: `w4-conc-${suffix}@example.com`,
      passwordHash: 'hash',
    });

    await credits.grant(workspace.id, 200_000, `grant-conc-${workspace.id}`);

    const outcomes = await Promise.allSettled([
      credits.appendEvent(workspace.id, {
        type: 'RESERVE',
        microunits: 100_000,
        idempotencyKey: `reserve-conc-a-${suffix}`,
      }),
      credits.appendEvent(workspace.id, {
        type: 'RESERVE',
        microunits: 100_000,
        idempotencyKey: `reserve-conc-b-${suffix}`,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    // Both should succeed with 200k grant; serialization must not lose an update.
    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(0);

    const bal = await credits.getBalances(workspace.id);
    expect(bal.availableMicrounits).toBe(0);
    expect(bal.heldMicrounits).toBe(200_000);

    // Over-reserve must fail after serialization (not silently corrupt snapshot).
    await expect(
      credits.appendEvent(workspace.id, {
        type: 'RESERVE',
        microunits: 1,
        idempotencyKey: `reserve-conc-over-${suffix}`,
      }),
    ).rejects.toThrow(/INSUFFICIENT|Insufficient/i);

    const bal2 = await credits.getBalances(workspace.id);
    expect(bal2.availableMicrounits).toBe(0);
    expect(bal2.heldMicrounits).toBe(200_000);

    const events = await credits.listEvents(workspace.id, 20);
    const reserves = events.filter((e) => e.type === 'RESERVE');
    expect(reserves).toHaveLength(2);
  });

  it('concurrent oversubscribe: exactly one RESERVE wins, snapshot stays consistent', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { workspace } = await users.createWithDefaultWorkspace({
      email: `w4-race-${suffix}@example.com`,
      passwordHash: 'hash',
    });

    await credits.grant(workspace.id, 100_000, `grant-race-${workspace.id}`);

    const outcomes = await Promise.allSettled([
      credits.appendEvent(workspace.id, {
        type: 'RESERVE',
        microunits: 100_000,
        idempotencyKey: `reserve-race-a-${suffix}`,
      }),
      credits.appendEvent(workspace.id, {
        type: 'RESERVE',
        microunits: 100_000,
        idempotencyKey: `reserve-race-b-${suffix}`,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const bal = await credits.getBalances(workspace.id);
    expect(bal.availableMicrounits).toBe(0);
    expect(bal.heldMicrounits).toBe(100_000);

    const events = await credits.listEvents(workspace.id, 20);
    expect(events.filter((e) => e.type === 'RESERVE')).toHaveLength(1);
  });
});
