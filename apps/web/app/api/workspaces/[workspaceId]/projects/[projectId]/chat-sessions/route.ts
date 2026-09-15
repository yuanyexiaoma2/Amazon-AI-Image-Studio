import { NextResponse } from 'next/server';
import { CreateChatSessionRequestSchema, makeApiError } from '@studio/contracts';
import { WORKFLOW_WRITE_ROLES } from '@studio/domain';
import {
  prisma,
  ChatRepository,
  ChatNotFoundError,
  ProjectRepository,
  WorkflowRepository,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember, requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeChatSession } from '@/lib/chat-serialize';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

/** GET /workspaces/{ws}/projects/{pid}/chat-sessions — list sessions (?workflowId= filter). */
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

  const workflowId = new URL(request.url).searchParams.get('workflowId') ?? undefined;

  const chat = new ChatRepository(prisma);
  const items = await chat.listSessions(workspaceId, projectId, { workflowId });
  return NextResponse.json(
    { items: items.map(serializeChatSession) },
    { headers: { 'x-request-id': requestId } },
  );
}

/** POST /workspaces/{ws}/projects/{pid}/chat-sessions — create a chat agent session. */
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

  const parsed = CreateChatSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError(
        'VALIDATION_ERROR',
        'Invalid create chat session payload',
        requestId,
        parsed.error.flatten(),
      ),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  // When bound to a workflow, the workflow must belong to this project.
  if (parsed.data.workflowId) {
    const workflows = new WorkflowRepository(prisma);
    const wf = await workflows.getWithDraft(workspaceId, parsed.data.workflowId);
    if (!wf || wf.projectId !== projectId) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', 'workflowId does not belong to this project', requestId, {
          workflowId: parsed.data.workflowId,
        }),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
  }

  const chat = new ChatRepository(prisma);
  try {
    const session = await chat.createSession({
      workspaceId,
      projectId,
      workflowId: parsed.data.workflowId ?? null,
      title: parsed.data.title ?? null,
      budgetLimit: parsed.data.budgetLimit ?? null,
      createdByUserId: access.session.userId,
    });
    return NextResponse.json(serializeChatSession(session), {
      status: 201,
      headers: { 'x-request-id': requestId },
    });
  } catch (err) {
    if (err instanceof ChatNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    throw err;
  }
}
