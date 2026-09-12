import { NextResponse } from 'next/server';
import { CreateVariantRunRequestSchema, makeApiError } from '@studio/contracts';
import { VARIANT_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  ProjectRepository,
  VariantRepository,
  VariantValidationError,
  VariantNotFoundError,
  VariantBudgetGateError,
  CreditInsufficientError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeVariantRun } from '@/lib/variant-serialize';
import { produceVariantFakeImage } from '@/lib/variant-fake-image';
import { ensureStorageReady } from '@/lib/storage';
import { runQaEvaluationInline } from '@/lib/run-qa-inline';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...VARIANT_WRITE_ROLES]);
  if (!access.ok) return access.response;

  const projects = new ProjectRepository(prisma);
  if (!(await projects.findById(workspaceId, projectId))) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }
  const parsed = CreateVariantRunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid variant-run payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const storage = await ensureStorageReady();
  const variants = new VariantRepository(prisma);
  const runQa =
    process.env.VARIANT_QA_INLINE === '1'
      ? runQaEvaluationInline
      : undefined;

  try {
    const run = await variants.createAndExecuteFakeRun({
      workspaceId,
      projectId,
      masterVariantId: parsed.data.masterVariantId,
      variantIds: parsed.data.variantIds,
      requestedByUserId: access.session.userId,
      idempotencyKey: parsed.data.idempotencyKey,
      budgetLimit: parsed.data.budgetLimit,
      confirmBudget: parsed.data.confirmBudget,
      scenario: parsed.data.scenario,
      visionScenario: parsed.data.visionScenario,
      itemScenarios: parsed.data.itemScenarios,
      putObject: (args) => storage.putObject(args),
      produceImage: produceVariantFakeImage,
      runQa,
    });
    return NextResponse.json(serializeVariantRun(run), {
      status: 201,
      headers: { 'x-request-id': requestId },
    });
  } catch (e) {
    if (e instanceof VariantBudgetGateError) {
      return NextResponse.json(
        makeApiError('BUDGET_EXCEEDED', e.message, requestId, {
          estimateMicrounits: e.estimateMicrounits,
          budgetAmount: e.budgetAmount,
        }),
        { status: 409, headers: { 'x-request-id': requestId } },
      );
    }
    if (e instanceof CreditInsufficientError) {
      return NextResponse.json(makeApiError('INSUFFICIENT_CREDITS', e.message, requestId), {
        status: 409,
        headers: { 'x-request-id': requestId },
      });
    }
    if (e instanceof VariantValidationError) {
      return NextResponse.json(makeApiError('VALIDATION_ERROR', e.message, requestId), {
        status: 400,
        headers: { 'x-request-id': requestId },
      });
    }
    if (e instanceof VariantNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', e.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    throw e;
  }
}
