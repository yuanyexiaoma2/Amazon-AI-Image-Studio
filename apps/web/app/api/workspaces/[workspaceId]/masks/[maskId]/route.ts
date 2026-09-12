import { NextResponse } from 'next/server';
import { makeApiError, UpdateMaskRequestSchema } from '@studio/contracts';
import { MaskRepository, prisma } from '@studio/db';
import { WORKFLOW_WRITE_ROLES } from '@studio/domain';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember, requireWorkspaceRoles } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string; maskId: string }> };

function serializeMask(m: {
  id: string;
  workspaceId: string;
  assetVersionId: string;
  strokesJson: unknown;
  coordinateSpace: string;
  metadataJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    assetVersionId: m.assetVersionId,
    strokes: m.strokesJson,
    coordinateSpace: m.coordinateSpace,
    metadata: m.metadataJson,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, maskId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const masks = new MaskRepository(prisma);
  const mask = await masks.findById(workspaceId, maskId);
  if (!mask) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Mask not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  return NextResponse.json(serializeMask(mask), { headers: { 'x-request-id': requestId } });
}

export async function PUT(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, maskId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...WORKFLOW_WRITE_ROLES]);
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }
  const parsed = UpdateMaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', parsed.error.message, requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const masks = new MaskRepository(prisma);
  const existing = await masks.findById(workspaceId, maskId);
  if (!existing) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Mask not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const prevMeta = (existing.metadataJson ?? {}) as Record<string, unknown>;
  const nextMeta = (parsed.data.metadata
    ? { ...prevMeta, ...parsed.data.metadata }
    : prevMeta) as never;

  const updated = await masks.update(workspaceId, maskId, {
    strokesJson: parsed.data.strokes as never,
    coordinateSpace: parsed.data.coordinateSpace,
    metadataJson: nextMeta,
  });

  return NextResponse.json(serializeMask(updated!), {
    headers: { 'x-request-id': requestId },
  });
}
