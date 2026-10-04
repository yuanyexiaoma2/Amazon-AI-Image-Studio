import { NextResponse } from 'next/server';
import { makeApiError, PatchChatSessionRequestSchema } from '@studio/contracts';
import { prisma, ChatRepository } from '@studio/db';
import { WORKFLOW_WRITE_ROLES } from '@studio/domain';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember, requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeChatMessage, serializeChatSession } from '@/lib/chat-serialize';

type Ctx = {
  params: Promise<{ workspaceId: string; projectId: string; sessionId: string }>;
};

/** GET /workspaces/{ws}/projects/{pid}/chat-sessions/{sid} — session + messages (?limit= ≤200, default 50). */
export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId, sessionId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const rawLimit = new URL(request.url).searchParams.get('limit');
  let limit = 50;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', 'limit must be an integer between 1 and 200', requestId),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
  }

  const chat = new ChatRepository(prisma);
  const session = await chat.getWithMessages(workspaceId, sessionId, { limit });
  if (!session || session.projectId !== projectId) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Chat session not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const { messages, ...sessionRow } = session;
  return NextResponse.json(
    {
      ...serializeChatSession(sessionRow),
      messages: messages.map(serializeChatMessage),
    },
    { headers: { 'x-request-id': requestId } },
  );
}

/** PATCH /workspaces/{ws}/projects/{pid}/chat-sessions/{sid} — 重命名会话（自动标题用）。 */
export async function PATCH(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId, sessionId } = await context.params;
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
  const parsed = PatchChatSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid patch chat session payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const chat = new ChatRepository(prisma);
  const existing = await chat.getSession(workspaceId, sessionId);
  if (!existing || existing.projectId !== projectId) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Chat session not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  const updated = await chat.renameSession(workspaceId, sessionId, parsed.data.title);
  return NextResponse.json(serializeChatSession(updated!), {
    headers: { 'x-request-id': requestId },
  });
}
