import { NextResponse } from 'next/server';
import { z } from 'zod';
import { makeApiError } from '@studio/contracts';
import { newId, prisma } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string }> };

const PatchWorkspaceSchema = z.object({
  autoApproveGates: z.boolean(),
});

const ADMIN_ROLES = ['OWNER', 'ADMIN'] as const;

/**
 * V2: workspace settings — auto-approve gates switch (personal self-use mode).
 * OWNER/ADMIN only; every change is audited.
 */
export async function PATCH(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, ADMIN_ROLES);
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
  const parsed = PatchWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid workspace patch', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { autoApproveGates: parsed.data.autoApproveGates },
    select: { id: true, name: true, autoApproveGates: true },
  });

  await prisma.auditEvent.create({
    data: {
      id: newId(),
      workspaceId,
      actorUserId: access.session.userId,
      action: 'workspace.auto_approve_gates_changed',
      subjectType: 'workspace',
      subjectId: workspaceId,
      metadataJson: { autoApproveGates: parsed.data.autoApproveGates },
    },
  });

  return NextResponse.json(updated, { headers: { 'x-request-id': requestId } });
}
