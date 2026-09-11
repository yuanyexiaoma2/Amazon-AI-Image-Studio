import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { AssetRepository, prisma } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { ensureStorageReady } from '@/lib/storage';

type Ctx = { params: Promise<{ workspaceId: string; versionId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, versionId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? 'THUMBNAIL_WEBP';

  const assets = new AssetRepository(prisma);
  const version = await assets.getVersionWithRepresentations(workspaceId, versionId);
  if (!version) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Asset version not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const rep =
    version.representations.find((r) => r.kind === kind) ??
    version.representations.find((r) => r.kind === 'NORMALIZED_PNG') ??
    version.representations[0];
  if (!rep) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'No representation', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const storage = await ensureStorageReady();
  const expiresInSeconds = 900;
  const signed = await storage.getSignedUrl({
    key: rep.storageKey,
    expiresInSeconds,
  });

  return NextResponse.json(
    {
      url: signed,
      expiresInSeconds,
      representationKind: rep.kind,
    },
    { headers: { 'x-request-id': requestId } },
  );
}
