/**
 * Billing order: FAILED_RETRYABLE must keep the RESERVE hold so BullMQ/same-attempt
 * retry can SETTLE without re-reserve.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  prisma,
  ProjectRepository,
  UserRepository,
  WorkflowRepository,
  CreditRepository,
  GenerationRepository,
  newId,
} from '@studio/db';
import { resetFakeProviderState } from '@studio/providers';
import { handleGenerationAttemptJob } from '../src/jobs/generation-attempt.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('generation attempt billing: FAILED_RETRYABLE keeps hold', () => {
  const users = new UserRepository(prisma);
  const projects = new ProjectRepository(prisma);
  const workflows = new WorkflowRepository(prisma);
  const credits = new CreditRepository(prisma);
  const gen = new GenerationRepository(prisma);

  beforeEach(() => {
    resetFakeProviderState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('RATE_LIMIT_THEN_SUCCESS: no REFUND on retryable; settle consumes hold', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `w4-retry-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `W4R-${suffix}`,
      name: 'W4 Retry Project',
    });

    await credits.grant(workspace.id, 5_000_000, `grant-retry-${workspace.id}`);

    const wf = await workflows.createWithGraph({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'w4-retry-run',
      createdByUserId: user.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: 'g1',
            type: 'generate',
            position: { x: 0, y: 0 },
            config: { schemaVersion: 1, prompt: 'retry product' },
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

    const { run: runRow } = await gen.createRun({
      workspaceId: workspace.id,
      workflowRevisionId: revision.id,
      requestedByUserId: user.id,
      idempotencyKey: newId(),
      confirmBudget: true,
      budgetLimit: { currency: 'USD', amount: 1 },
      scenario: 'RATE_LIMIT_THEN_SUCCESS',
    });

    const attempt = runRow.items[0]!.attempts[0]!;
    const jobData = {
      workspaceId: workspace.id,
      projectId: project.id,
      runId: runRow.id,
      itemId: runRow.items[0]!.id,
      attemptId: attempt.id,
    };

    const afterReserve = await credits.getBalances(workspace.id);
    expect(afterReserve.heldMicrounits).toBeGreaterThan(0);
    const heldAfterReserve = afterReserve.heldMicrounits;

    // First execution: RATE_LIMIT → FAILED_RETRYABLE, throw for BullMQ retry
    await expect(handleGenerationAttemptJob(jobData)).rejects.toThrow(/RETRYABLE:RATE_LIMIT/);

    const midAttempt = await prisma.generationAttempt.findFirstOrThrow({
      where: { id: attempt.id },
    });
    expect(midAttempt.status).toBe('FAILED_RETRYABLE');

    const eventsAfterFail = await credits.listEvents(workspace.id, 50);
    expect(eventsAfterFail.some((e) => e.type === 'REFUND')).toBe(false);
    expect(eventsAfterFail.some((e) => e.type === 'SETTLE')).toBe(false);

    const midBal = await credits.getBalances(workspace.id);
    expect(midBal.heldMicrounits).toBe(heldAfterReserve);

    // Second execution (BullMQ retry / worker restart): same attempt, hold intact → settle
    const second = await handleGenerationAttemptJob(jobData);
    expect(second).toMatchObject({ ok: true, status: 'SUCCEEDED' });

    const finalAttempt = await prisma.generationAttempt.findFirstOrThrow({
      where: { id: attempt.id },
    });
    expect(finalAttempt.status).toBe('SUCCEEDED');

    const eventsFinal = await credits.listEvents(workspace.id, 50);
    expect(eventsFinal.some((e) => e.type === 'SETTLE')).toBe(true);
    expect(eventsFinal.some((e) => e.type === 'REFUND')).toBe(false);

    const finalBal = await credits.getBalances(workspace.id);
    expect(finalBal.heldMicrounits).toBe(0);
    expect(finalBal.consumedMicrounits).toBeGreaterThan(0);
  });

  it('AUTH → FAILED_FINAL refunds hold (terminal)', async () => {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `w4-auth-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `W4A-${suffix}`,
      name: 'W4 Auth Project',
    });

    await credits.grant(workspace.id, 5_000_000, `grant-auth-${workspace.id}`);

    const wf = await workflows.createWithGraph({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'w4-auth-run',
      createdByUserId: user.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: 'g1',
            type: 'generate',
            position: { x: 0, y: 0 },
            config: { schemaVersion: 1, prompt: 'auth fail' },
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

    const { run: runRow } = await gen.createRun({
      workspaceId: workspace.id,
      workflowRevisionId: revision.id,
      requestedByUserId: user.id,
      idempotencyKey: newId(),
      confirmBudget: true,
      budgetLimit: { currency: 'USD', amount: 1 },
      scenario: 'AUTH',
    });

    const attempt = runRow.items[0]!.attempts[0]!;
    const afterReserve = await credits.getBalances(workspace.id);
    expect(afterReserve.heldMicrounits).toBeGreaterThan(0);

    const result = await handleGenerationAttemptJob({
      workspaceId: workspace.id,
      projectId: project.id,
      runId: runRow.id,
      itemId: runRow.items[0]!.id,
      attemptId: attempt.id,
    });
    expect(result).toMatchObject({ ok: false, status: 'FAILED_FINAL' });

    const events = await credits.listEvents(workspace.id, 50);
    expect(events.some((e) => e.type === 'REFUND')).toBe(true);
    expect(events.some((e) => e.type === 'SETTLE')).toBe(false);

    const bal = await credits.getBalances(workspace.id);
    expect(bal.heldMicrounits).toBe(0);
  });
});
