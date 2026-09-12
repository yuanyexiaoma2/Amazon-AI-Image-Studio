import { NextResponse } from 'next/server';
import { makeApiError, CreateMaskRequestSchema } from '@studio/contracts';
import { MaskRepository, AssetRepository, prisma } from '@studio/db';
import { WORKFLOW_WRITE_ROLES } from '@studio/domain';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember, requireWorkspaceRoles } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string; versionId: string }> };

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
  const { workspaceId, versionId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const assets = new AssetRepository(prisma);
  const version = await assets.getVersionWithRepresentations(workspaceId, versionId);
  if (!version) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Asset version not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const masks = new MaskRepository(prisma);
  const items = await masks.listForAssetVersion(workspaceId, versionId);
  return NextResponse.json(
    { items: items.map(serializeMask) },
    { headers: { 'x-request-id': requestId } },
  );
}

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, versionId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...WORKFLOW_WRITE_ROLES]);
  if (!access.ok) return access.response;

  const assets = new AssetRepository(prisma);
  const version = await assets.getVersionWithRepresentations(workspaceId, versionId);
  if (!version) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Asset version not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }
  const parsed = CreateMaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', parsed.error.message, requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const meta = {
    ...(parsed.data.metadata ?? {}),
    sourceWidth: parsed.data.metadata?.sourceWidth ?? version.width ?? undefined,
    sourceHeight: parsed.data.metadata?.sourceHeight ?? version.height ?? undefined,
  };

  const masks = new MaskRepository(prisma);
  const created = await masks.create({
    workspaceId,
    assetVersionId: versionId,
    strokesJson: parsed.data.strokes as never,
    coordinateSpace: parsed.data.coordinateSpace,
    metadataJson: meta as never,
  });

  return NextResponse.json(serializeMask(created), {
    status: 201,
    headers: { 'x-request-id': requestId },
  });
}
