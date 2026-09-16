import { NextResponse } from 'next/server';
import { CreateRunRequestSchema, makeApiError } from '@studio/contracts';
import { RUN_WRITE_ROLES } from '@studio/domain';
import { getOrCreateRequestId } from '@/lib/request-id';
import { paidGateResponse, requireWorkspaceRoles } from '@/lib/workspace-access';
import { createRunForRevision } from '@/lib/create-run';

type Ctx = { params: Promise<{ workspaceId: string; revisionId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, revisionId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...RUN_WRITE_ROLES]);
  if (!access.ok) return access.response;
  // PR-6: creating a run spends credits and calls the image provider — paid
  // action in local mode.
  const paidGate = await paidGateResponse(requestId);
  if (paidGate) return paidGate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const parsed = CreateRunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid run payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const outcome = await createRunForRevision({
    workspaceId,
    revisionId,
    request: parsed.data,
    userId: access.session.userId,
    requestId,
  });

  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: { 'x-request-id': requestId },
  });
}
