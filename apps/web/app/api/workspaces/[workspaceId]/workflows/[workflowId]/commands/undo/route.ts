import { NextResponse } from 'next/server';
import { UndoWorkflowCommandsRequestSchema, makeApiError } from '@studio/contracts';
import { WORKFLOW_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  WorkflowRepository,
  WorkflowConflictError,
  WorkflowNotFoundError,
  WorkflowUndoError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeWorkflowDraft } from '@/lib/workflow-serialize';

type Ctx = { params: Promise<{ workspaceId: string; workflowId: string }> };

/** POST .../commands/undo — roll the draft back to a batch's beforeGraph. */
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

  const parsed = UndoWorkflowCommandsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid undo payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const workflows = new WorkflowRepository(prisma);
  try {
    const { draft } = await workflows.undoCommandBatch({
      workspaceId,
      workflowId,
      ifRevision: parsed.data.ifRevision,
      batchId: parsed.data.batchId,
    });
    if (!draft.draft) {
      return NextResponse.json(makeApiError('INTERNAL_ERROR', 'Draft missing', requestId), {
        status: 500,
        headers: { 'x-request-id': requestId },
      });
    }
    return NextResponse.json(
      serializeWorkflowDraft({
        workflowId: draft.id,
        projectId: draft.projectId,
        name: draft.name,
        currentRevisionId: draft.currentRevisionId,
        revisionNumber: draft.draft.revisionNumber,
        graph: workflows.parseGraph(draft.draft),
        updatedAt: draft.draft.updatedAt,
        updatedByUserId: draft.draft.updatedByUserId,
      }),
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof WorkflowUndoError) {
      return NextResponse.json(
        makeApiError('WORKFLOW_UNDO_CONFLICT', err.message, requestId, { reason: err.reason }),
        { status: 409, headers: { 'x-request-id': requestId } },
      );
    }
    if (err instanceof WorkflowNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof WorkflowConflictError) {
      return NextResponse.json(
        makeApiError('WORKFLOW_REVISION_CONFLICT', err.message, requestId),
        { status: 409, headers: { 'x-request-id': requestId } },
      );
    }
    throw err;
  }
}
