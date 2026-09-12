import { NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { VARIANT_ADMIN_ROLES } from '@studio/domain';
import { VariantRepository, prisma } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...VARIANT_ADMIN_ROLES]);
  if (!access.ok) return access.response;
  const variants = new VariantRepository(prisma);
  const result = await variants.reconcileCredits(workspaceId);
  return NextResponse.json(result, { headers: { 'x-request-id': requestId } });
}
