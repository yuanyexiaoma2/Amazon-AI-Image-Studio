import { NextResponse } from 'next/server';
import { SnapshotWorkflowRequestSchema, makeApiError } from '@studio/contracts';
import { WORKFLOW_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  WorkflowRepository,
  WorkflowConflictError,
  WorkflowValidationError,
  WorkflowNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeWorkflowDraft } from '@/lib/workflow-serialize';

type Ctx = { params: Promise<{ workspaceId: string; workflowId: string }> };

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

  const parsed = SnapshotWorkflowRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid snapshot payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const workflows = new WorkflowRepository(prisma);
  try {
    const { workflow, revision } = await workflows.snapshot({
      workspaceId,
      workflowId,
      ifRevision: parsed.data.ifRevision,
      createdByUserId: access.session.userId,
    });
    if (!workflow.draft) {
      return NextResponse.json(makeApiError('INTERNAL_ERROR', 'Draft missing', requestId), {
        status: 500,
        headers: { 'x-request-id': requestId },
      });
    }
    return NextResponse.json(
      {
        draft: serializeWorkflowDraft({
          workflowId: workflow.id,
          projectId: workflow.projectId,
          name: workflow.name,
          currentRevisionId: workflow.currentRevisionId,
          revisionNumber: workflow.draft.revisionNumber,
          graph: workflows.parseGraph(workflow.draft),
          updatedAt: workflow.draft.updatedAt,
          updatedByUserId: workflow.draft.updatedByUserId,
        }),
        revision: {
          id: revision.id,
          workflowId: revision.workflowId,
          revision: revision.revision,
          graph: workflows.parseGraphJson(revision.graphJson),
          createdAt: revision.createdAt.toISOString(),
          createdByUserId: revision.createdByUserId,
        },
      },
      { status: 201, headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
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
    if (err instanceof WorkflowValidationError) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', err.message, requestId, err.details),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
    throw err;
  }
}
