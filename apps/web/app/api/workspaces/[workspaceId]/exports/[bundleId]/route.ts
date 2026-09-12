import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { ExportRepository, prisma } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeExportBundle } from '@/lib/qa-serialize';

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
  return NextResponse.json(serializeExportBundle(bundle), { headers: { 'x-request-id': requestId } });
}
