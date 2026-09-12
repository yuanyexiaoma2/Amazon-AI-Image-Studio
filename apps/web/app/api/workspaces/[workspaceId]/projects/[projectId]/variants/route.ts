import { NextResponse } from 'next/server';
import { CreateVariantRequestSchema, makeApiError } from '@studio/contracts';
import { VARIANT_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  ProjectRepository,
  VariantRepository,
  VariantValidationError,
  VariantNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember, requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeVariant } from '@/lib/variant-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const projects = new ProjectRepository(prisma);
  if (!(await projects.findById(workspaceId, projectId))) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  const variants = new VariantRepository(prisma);
  const items = await variants.listByProject(workspaceId, projectId);
  return NextResponse.json(
    { items: items.map(serializeVariant) },
    { headers: { 'x-request-id': requestId } },
  );
}

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
  const parsed = CreateVariantRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid variant payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const variants = new VariantRepository(prisma);
  try {
    const created = await variants.create({
      workspaceId,
      projectId,
      code: parsed.data.code,
      displayName: parsed.data.displayName,
      masterVariantId: parsed.data.masterVariantId,
      components: parsed.data.components,
      status: parsed.data.status,
    });
    return NextResponse.json(serializeVariant(created), {
      status: 201,
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
