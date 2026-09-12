import { NextResponse } from 'next/server';
import { PatchVariantRequestSchema, makeApiError } from '@studio/contracts';
import { VARIANT_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  VariantRepository,
  VariantValidationError,
  VariantNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember, requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeVariant } from '@/lib/variant-serialize';

type Ctx = { params: Promise<{ workspaceId: string; variantId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, variantId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;
  const variants = new VariantRepository(prisma);
  const v = await variants.get(workspaceId, variantId);
  if (!v) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Variant not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  return NextResponse.json(serializeVariant(v), { headers: { 'x-request-id': requestId } });
}

export async function PATCH(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, variantId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...VARIANT_WRITE_ROLES]);
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
  const parsed = PatchVariantRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid patch payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }
  const variants = new VariantRepository(prisma);
  try {
    const updated = await variants.patch(workspaceId, variantId, parsed.data);
    return NextResponse.json(serializeVariant(updated), { headers: { 'x-request-id': requestId } });
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
