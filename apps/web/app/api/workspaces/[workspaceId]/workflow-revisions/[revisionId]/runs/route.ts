import { NextResponse } from 'next/server';
import { CreateRunRequestSchema, makeApiError } from '@studio/contracts';
import { RUN_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  GenerationRepository,
  GenerationValidationError,
  GenerationNotFoundError,
  BudgetGateError,
  CreditInsufficientError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { enqueueGenerationFromOutbox } from '@/lib/queues';
import { serializeRun } from '@/lib/generation-serialize';

type Ctx = { params: Promise<{ workspaceId: string; revisionId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, revisionId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...RUN_WRITE_ROLES]);
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const parsed = CreateRunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid run payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const repo = new GenerationRepository(prisma);
  try {
    const { run, outboxRows, created } = await repo.createRun({
      workspaceId,
      workflowRevisionId: revisionId,
      requestedByUserId: access.session.userId,
      scope: parsed.data.scope,
      reuseSucceededInputs: parsed.data.reuseSucceededInputs,
      budgetLimit: parsed.data.budgetLimit,
      confirmBudget: parsed.data.confirmBudget,
      idempotencyKey: parsed.data.idempotencyKey,
      modelKey: parsed.data.modelKey,
      scenario: parsed.data.scenario,
    });

    for (const row of outboxRows) {
      await enqueueGenerationFromOutbox(row);
    }

    return NextResponse.json(
      { run: serializeRun(run), created },
      { status: created ? 201 : 200, headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof BudgetGateError) {
      return NextResponse.json(
        makeApiError('BUDGET_EXCEEDED', err.message, requestId, {
          estimateMicrounits: err.estimateMicrounits,
          budgetAmount: err.budgetAmount,
        }),
        { status: 402, headers: { 'x-request-id': requestId } },
      );
    }
    if (err instanceof CreditInsufficientError) {
      return NextResponse.json(makeApiError('INSUFFICIENT_CREDITS', err.message, requestId), {
        status: 402,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof GenerationNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof GenerationValidationError) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', err.message, requestId, err.details),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
    throw err;
  }
}
