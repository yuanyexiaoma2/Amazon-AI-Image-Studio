import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, VariantRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeVariantRun } from '@/lib/variant-serialize';

type Ctx = { params: Promise<{ workspaceId: string; runId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, runId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;
  const variants = new VariantRepository(prisma);
  const run = await variants.getRun(workspaceId, runId);
  if (!run) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Variant run not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  return NextResponse.json(serializeVariantRun(run), { headers: { 'x-request-id': requestId } });
}
