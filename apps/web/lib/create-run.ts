import { makeApiError, type ApiError, type CreateRunRequest } from '@studio/contracts';
import {
  prisma,
  GenerationRepository,
  GenerationValidationError,
  GenerationNotFoundError,
  BudgetGateError,
  CreditInsufficientError,
} from '@studio/db';
import { enqueueGenerationFromOutbox } from '@/lib/queues';
import { serializeRun } from '@/lib/generation-serialize';

export type CreateRunOutcome =
  | {
      ok: true;
      status: 200 | 201;
      body: { run: ReturnType<typeof serializeRun>; created: boolean };
    }
  | { ok: false; status: number; body: ApiError };

/**
 * Shared run-creation path (V2 PR-2): used by POST /workflow-revisions/{id}/runs
 * and by the trailing `run` command of POST /workflows/{id}/commands.
 * Budget gate (402), idempotency (created:false -> 200) and outbox enqueue
 * semantics are identical to the original route handler.
 */
export async function createRunForRevision(args: {
  workspaceId: string;
  revisionId: string;
  request: CreateRunRequest;
  userId: string;
  requestId: string;
}): Promise<CreateRunOutcome> {
  const repo = new GenerationRepository(prisma);
  try {
    const { run, outboxRows, created } = await repo.createRun({
      workspaceId: args.workspaceId,
      workflowRevisionId: args.revisionId,
      requestedByUserId: args.userId,
      scope: args.request.scope,
      reuseSucceededInputs: args.request.reuseSucceededInputs,
      budgetLimit: args.request.budgetLimit,
      confirmBudget: args.request.confirmBudget,
      idempotencyKey: args.request.idempotencyKey,
      modelKey: args.request.modelKey,
      scenario: args.request.scenario,
    });

    for (const row of outboxRows) {
      await enqueueGenerationFromOutbox(row);
    }

    return {
      ok: true,
      status: created ? 201 : 200,
      body: { run: serializeRun(run), created },
    };
  } catch (err) {
    if (err instanceof BudgetGateError) {
      return {
        ok: false,
        status: 402,
        body: makeApiError('BUDGET_EXCEEDED', err.message, args.requestId, {
          estimateMicrounits: err.estimateMicrounits,
          budgetAmount: err.budgetAmount,
        }),
      };
    }
    if (err instanceof CreditInsufficientError) {
      return {
        ok: false,
        status: 402,
        body: makeApiError('INSUFFICIENT_CREDITS', err.message, args.requestId),
      };
    }
    if (err instanceof GenerationNotFoundError) {
      return {
        ok: false,
        status: 404,
        body: makeApiError('NOT_FOUND', err.message, args.requestId),
      };
    }
    if (err instanceof GenerationValidationError) {
      return {
        ok: false,
        status: 400,
        body: makeApiError('VALIDATION_ERROR', err.message, args.requestId, err.details),
      };
    }
    throw err;
  }
}
