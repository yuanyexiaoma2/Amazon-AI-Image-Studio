import { NextResponse } from 'next/server';
import { MaterializeVariantRequestSchema, makeApiError } from '@studio/contracts';
import { VARIANT_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  VariantRepository,
  VariantValidationError,
  VariantNotFoundError,
  WorkflowValidationError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeVariant } from '@/lib/variant-serialize';

type Ctx = { params: Promise<{ workspaceId: string; variantId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, variantId } = await context.params;
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
  const parsed = MaterializeVariantRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid materialize payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const variants = new VariantRepository(prisma);
  try {
    const result = await variants.materialize({
      workspaceId,
      variantId,
      createdByUserId: access.session.userId,
      sourceWorkflowId: parsed.data.sourceWorkflowId,
      name: parsed.data.name,
    });
    return NextResponse.json(
      {
        variant: serializeVariant(result.variant),
        workflowId: result.workflowId,
        revisionId: result.revisionId,
      },
      { status: 201, headers: { 'x-request-id': requestId } },
    );
  } catch (e) {
    if (e instanceof VariantValidationError || e instanceof WorkflowValidationError) {
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
