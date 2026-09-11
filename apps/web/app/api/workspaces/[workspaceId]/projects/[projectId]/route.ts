import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { prisma, ProjectRepository, UserRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import {
  requireActiveSession,
  SessionGuardError,
  sessionGuardStatus,
} from '@/lib/session-guard';

type Ctx = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId } = await context.params;

  try {
    const active = await requireActiveSession();
    const users = new UserRepository(prisma);
    const member = await users.isMemberOfWorkspace(active.userId, workspaceId);
    if (!member) {
      return NextResponse.json(
        makeApiError('FORBIDDEN', 'Cross-workspace access denied', requestId),
        { status: 403, headers: { 'x-request-id': requestId } },
      );
    }

    const projects = new ProjectRepository(prisma);
    const project = await projects.findById(workspaceId, projectId);
    if (!project) {
      return NextResponse.json(makeApiError('NOT_FOUND', 'Project not found', requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }

    return NextResponse.json(
      {
        id: project.id,
        workspaceId: project.workspaceId,
        sku: project.sku,
        name: project.name,
        marketplace: project.marketplace,
        category: project.category,
        asin: project.asin,
        status: project.status,
        createdAt: project.createdAt.toISOString(),
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof SessionGuardError) {
      return NextResponse.json(makeApiError(err.code, err.message, requestId), {
        status: sessionGuardStatus(err),
        headers: { 'x-request-id': requestId },
      });
    }
    throw err;
  }
}
