import { NextResponse } from 'next/server';
import { CreateProjectRequestSchema, makeApiError } from '@studio/contracts';
import { prisma, ProjectRepository, UserRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import {
  requireActiveSession,
  SessionGuardError,
  sessionGuardStatus,
} from '@/lib/session-guard';

type Ctx = { params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;

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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }

    const parsed = CreateProjectRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', 'Invalid project payload', requestId, parsed.error.flatten()),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }

    const projects = new ProjectRepository(prisma);
    const project = await projects.create({
      workspaceId,
      sku: parsed.data.sku,
      name: parsed.data.name,
      marketplace: parsed.data.marketplace,
      category: parsed.data.category ?? null,
      asin: parsed.data.asin ?? null,
    });

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
      { status: 201, headers: { 'x-request-id': requestId } },
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

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;

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
    const list = await projects.listByWorkspace(workspaceId);
    return NextResponse.json(
      {
        items: list.map((p) => ({
          id: p.id,
          workspaceId: p.workspaceId,
          sku: p.sku,
          name: p.name,
          status: p.status,
        })),
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
