import { NextResponse } from 'next/server';
import { RetryVariantItemRequestSchema, makeApiError } from '@studio/contracts';
import { VARIANT_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  VariantRepository,
  VariantValidationError,
  VariantNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeVariantItem } from '@/lib/variant-serialize';
import { produceVariantFakeImage } from '@/lib/variant-fake-image';
import { ensureStorageReady } from '@/lib/storage';
import { runQaEvaluationInline } from '@/lib/run-qa-inline';

type Ctx = { params: Promise<{ workspaceId: string; itemId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, itemId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...VARIANT_WRITE_ROLES]);
  if (!access.ok) return access.response;

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }
  const parsed = RetryVariantItemRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid retry payload', requestId, parsed.error.flatten()),
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
    const item = await variants.retryItem({
      workspaceId,
      itemId,
      requestedByUserId: access.session.userId,
      scenario: parsed.data.scenario,
      visionScenario: parsed.data.visionScenario,
      putObject: (args) => storage.putObject(args),
      produceImage: produceVariantFakeImage,
      runQa,
    });
    return NextResponse.json(serializeVariantItem(item), {
      status: 200,
      headers: { 'x-request-id': requestId },
    });
  } catch (e) {
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
