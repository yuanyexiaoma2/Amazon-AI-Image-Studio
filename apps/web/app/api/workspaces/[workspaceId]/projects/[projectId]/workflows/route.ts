import { NextResponse } from 'next/server';
import { CreateWorkflowRequestSchema, makeApiError } from '@studio/contracts';
import { WORKFLOW_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  ProjectRepository,
  WorkflowRepository,
  WorkflowNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember, requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeWorkflowDraft } from '@/lib/workflow-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const projects = new ProjectRepository(prisma);
  const project = await projects.findById(workspaceId, projectId);
  if (!project) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const workflows = new WorkflowRepository(prisma);
  const items = await workflows.listByProject(workspaceId, projectId);
  return NextResponse.json(
    { items: items.map((w) => ({ id: w.id, name: w.name, currentRevisionId: w.currentRevisionId })) },
    { headers: { 'x-request-id': requestId } },
  );
}

/** Create empty workflow + draft (revisionNumber 0). */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...WORKFLOW_WRITE_ROLES]);
  if (!access.ok) return access.response;

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const parsed = CreateWorkflowRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid create workflow payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const workflows = new WorkflowRepository(prisma);
  try {
    const created = await workflows.createEmpty({
      workspaceId,
      projectId,
      name: parsed.data.name,
      createdByUserId: access.session.userId,
    });
    if (!created.draft) {
      return NextResponse.json(makeApiError('INTERNAL_ERROR', 'Draft missing', requestId), {
        status: 500,
        headers: { 'x-request-id': requestId },
      });
    }
    return NextResponse.json(
      serializeWorkflowDraft({
        workflowId: created.id,
        projectId: created.projectId,
        name: created.name,
        currentRevisionId: created.currentRevisionId,
        revisionNumber: created.draft.revisionNumber,
        graph: workflows.parseGraph(created.draft),
        updatedAt: created.draft.updatedAt,
        updatedByUserId: created.draft.updatedByUserId,
      }),
      { status: 201, headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    throw err;
  }
}
