import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { ExportRepository, prisma } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { ensureStorageReady } from '@/lib/storage';

type Ctx = { params: Promise<{ workspaceId: string; bundleId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, bundleId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;
  const exports = new ExportRepository(prisma);
  const bundle = await exports.getBundle(workspaceId, bundleId);
  if (!bundle) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Export bundle not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  if (bundle.status !== 'SUCCEEDED' || !bundle.zipStorageKey) {
    return NextResponse.json(makeApiError('CONFLICT', 'Export ZIP is not ready', requestId), {
      status: 409,
      headers: { 'x-request-id': requestId },
    });
  }
  const storage = await ensureStorageReady();
  const expiresInSeconds = 900;
  const url = await storage.getSignedUrl({ key: bundle.zipStorageKey, expiresInSeconds });
  return NextResponse.json(
    {
      url,
      expiresInSeconds,
      zipSha256: bundle.zipSha256,
      bytes: bundle.zipBytes,
      manifestSha256: bundle.manifestSha256,
    },
    { headers: { 'x-request-id': requestId } },
  );
}
