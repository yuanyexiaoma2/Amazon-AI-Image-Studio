import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { AssetRepository, prisma } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string; assetId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, assetId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const assets = new AssetRepository(prisma);
  const asset = await assets.findById(workspaceId, assetId);
  if (!asset) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Asset not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  const versions = await assets.listVersions(workspaceId, assetId);
  return NextResponse.json(
    {
      id: asset.id,
      workspaceId: asset.workspaceId,
      projectId: asset.projectId,
      kind: asset.kind,
      status: asset.status,
      currentVersionId: asset.currentVersionId,
      originalFilename: asset.originalFilename,
      createdAt: asset.createdAt.toISOString(),
      versions: versions.map((v) => ({
        id: v.id,
        assetId: v.assetId,
        versionNumber: v.versionNumber,
        sha256: v.sha256,
        mime: v.mime,
        width: v.width,
        height: v.height,
        colorSpace: v.colorSpace,
        byteSize: v.byteSize,
        representations: v.representations.map((r) => ({
          kind: r.kind,
          storageKey: r.storageKey,
          contentType: r.contentType,
          bytes: r.bytes,
          width: r.width,
          height: r.height,
        })),
      })),
    },
    { headers: { 'x-request-id': requestId } },
  );
}

export async function DELETE(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, assetId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const assets = new AssetRepository(prisma);
  try {
    const asset = await assets.softDelete(workspaceId, assetId);
    return NextResponse.json(
      { id: asset.id, status: asset.status, deletedAt: asset.deletedAt?.toISOString() },
      { headers: { 'x-request-id': requestId } },
    );
  } catch {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Asset not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
}
