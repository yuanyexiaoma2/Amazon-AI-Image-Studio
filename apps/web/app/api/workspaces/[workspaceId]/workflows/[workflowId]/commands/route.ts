import { NextResponse } from 'next/server';
import { ApplyWorkflowCommandsRequestSchema, makeApiError } from '@studio/contracts';
import { WORKFLOW_WRITE_ROLES } from '@studio/domain';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { applyCommandsToWorkflow } from '@/lib/apply-commands';

type Ctx = { params: Promise<{ workspaceId: string; workflowId: string }> };

/**
 * POST /workspaces/{ws}/workflows/{wf}/commands — V2 PR-2 canvas command layer.
 * Thin shell over lib/apply-commands (shared with the PR-4 chat agent turn):
 * applies an ordered command batch atomically (idempotent on batchId), then —
 * when the batch ends with a `run` command — snapshots the new draft and
 * creates a generation run via the shared create-run path.
 */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, workflowId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...WORKFLOW_WRITE_ROLES]);
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const parsed = ApplyWorkflowCommandsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid commands payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const outcome = await applyCommandsToWorkflow({
    workspaceId,
    workflowId,
    ifRevision: parsed.data.ifRevision,
    batchId: parsed.data.batchId,
    actorUserId: access.session.userId,
    commands: parsed.data.commands,
    requestId,
  });

  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: { 'x-request-id': requestId },
  });
}
