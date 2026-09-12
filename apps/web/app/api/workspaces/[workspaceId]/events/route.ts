import { prisma, GenerationRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';
import { makeApiError } from '@studio/contracts';

type Ctx = { params: Promise<{ workspaceId: string }> };

/**
 * SSE progress stream: GET /api/workspaces/{workspaceId}/events?projectId=
 * Spec §12.4 — poll ProgressEvent rows (Redis fan-out optional later).
 */
export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) {
    return Response.json(makeApiError('VALIDATION_ERROR', 'projectId required', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
  });
  if (!project) {
    return Response.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const repo = new GenerationRepository(prisma);
  let last = new Date(0);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send('ready', { projectId, requestId });

      const tick = async () => {
        const rows = await repo.listProgressSince(workspaceId, projectId, last, 50);
        for (const row of rows) {
          last = row.createdAt;
          send(row.type, {
            id: row.id,
            runId: row.runId,
            attemptId: row.attemptId,
            payload: row.payloadJson,
            createdAt: row.createdAt.toISOString(),
          });
        }
      };

      await tick();
      const interval = setInterval(() => {
        void tick().catch((err) => {
          send('error', { message: err instanceof Error ? err.message : String(err) });
        });
      }, 1000);

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);

      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'x-request-id': requestId,
    },
  });
}
