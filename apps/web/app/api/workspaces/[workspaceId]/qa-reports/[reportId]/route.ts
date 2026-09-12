import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { QaRepository, prisma } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { serializeQaReport } from '@/lib/qa-serialize';

type Ctx = { params: Promise<{ workspaceId: string; reportId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, reportId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const qa = new QaRepository(prisma);
  const report = await qa.getReport(workspaceId, reportId);
  if (!report) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'QA report not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  return NextResponse.json(serializeQaReport(report), { headers: { 'x-request-id': requestId } });
}
