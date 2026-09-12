import { NextResponse } from 'next/server';
import { DEFAULT_MODEL_REGISTRY, listEnabledModels } from '@studio/domain';
import { prisma, CreditRepository } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceMember } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;
  const access = await requireWorkspaceMember(workspaceId, requestId);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const operation = url.searchParams.get('operation') ?? undefined;
  const models = listEnabledModels(
    DEFAULT_MODEL_REGISTRY,
    operation as never,
  );

  const credits = new CreditRepository(prisma);
  await credits.ensureAccount(workspaceId);
  // Seed demo grant once for local/dev/e2e
  await credits.grant(workspaceId, 10_000_000, `seed-grant:${workspaceId}`, 'W4 demo grant $10');
  const bal = await credits.getBalances(workspaceId);

  return NextResponse.json(
    {
      models,
      credits: {
        currency: 'USD',
        availableMicrounits: bal.availableMicrounits,
        heldMicrounits: bal.heldMicrounits,
        consumedMicrounits: bal.consumedMicrounits,
      },
    },
    { headers: { 'x-request-id': requestId } },
  );
}
