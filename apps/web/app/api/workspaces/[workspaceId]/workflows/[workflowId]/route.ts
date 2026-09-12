import { NextResponse } from 'next/server';
import { PatchWorkflowRequestSchema, parseWorkflowGraphWithConfigs, makeApiError } from '@studio/contracts';
import { WORKFLOW_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  WorkflowRepository,
  WorkflowConflictError,
  WorkflowValidationError,
  WorkflowNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember, requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeWorkflowDraft } from '@/lib/workflow-serialize';

type Ctx = { params: Promise<{ workspaceId: string; workflowId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, workflowId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const workflows = new WorkflowRepository(prisma);
  const wf = await workflows.getWithDraft(workspaceId, workflowId);
  if (!wf?.draft) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Workflow not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  return NextResponse.json(
    serializeWorkflowDraft({
      workflowId: wf.id,
      projectId: wf.projectId,
      name: wf.name,
      currentRevisionId: wf.currentRevisionId,
      revisionNumber: wf.draft.revisionNumber,
      graph: workflows.parseGraph(wf.draft),
      updatedAt: wf.draft.updatedAt,
      updatedByUserId: wf.draft.updatedByUserId,
    }),
    { headers: { 'x-request-id': requestId } },
  );
}

/** PATCH with ifRevision — 409 WORKFLOW_REVISION_CONFLICT on stale revision. */
export async function PATCH(request: Request, context: Ctx) {
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

  const parsed = PatchWorkflowRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid workflow patch', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const graphParsed = parseWorkflowGraphWithConfigs(parsed.data.graph);
  if (!graphParsed.ok) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid node configs', requestId, graphParsed.issues),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const workflows = new WorkflowRepository(prisma);
  try {
    const saved = await workflows.saveDraft({
      workspaceId,
      workflowId,
      ifRevision: parsed.data.ifRevision,
      graph: graphParsed.graph,
      updatedByUserId: access.session.userId,
      name: parsed.data.name,
    });
    if (!saved.draft) {
      return NextResponse.json(makeApiError('INTERNAL_ERROR', 'Draft missing', requestId), {
        status: 500,
        headers: { 'x-request-id': requestId },
      });
    }
    return NextResponse.json(
      serializeWorkflowDraft({
        workflowId: saved.id,
        projectId: saved.projectId,
        name: saved.name,
        currentRevisionId: saved.currentRevisionId,
        revisionNumber: saved.draft.revisionNumber,
        graph: workflows.parseGraph(saved.draft),
        updatedAt: saved.draft.updatedAt,
        updatedByUserId: saved.draft.updatedByUserId,
      }),
      { headers: { 'x-request-id': requestId } },
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
