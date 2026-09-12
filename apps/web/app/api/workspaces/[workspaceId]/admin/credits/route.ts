import { NextResponse } from 'next/server';
import { CreditAdjustRequestSchema, makeApiError } from '@studio/contracts';
import { VARIANT_ADMIN_ROLES } from '@studio/domain';
import { CreditRepository, prisma, newId } from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';

type Ctx = { params: Promise<{ workspaceId: string }> };

/** OWNER/ADMIN credit ADJUST (append-only ledger). */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...VARIANT_ADMIN_ROLES]);
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
  const parsed = CreditAdjustRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid adjust payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const credits = new CreditRepository(prisma);
  const balances = await credits.appendEvent(workspaceId, {
    type: 'ADJUST',
    microunits: parsed.data.microunits,
    idempotencyKey: parsed.data.idempotencyKey,
    note: `admin adjust by ${access.session.userId}: ${parsed.data.note}`,
  });

  await prisma.auditEvent.create({
    data: {
      id: newId(),
      workspaceId,
      actorUserId: access.session.userId,
      action: 'credits.adjust',
      subjectType: 'credit_account',
      subjectId: workspaceId,
      metadataJson: {
        microunits: parsed.data.microunits,
        note: parsed.data.note,
        idempotencyKey: parsed.data.idempotencyKey,
        role: access.role,
      },
    },
  });

  return NextResponse.json(
    { balances, note: parsed.data.note },
    { status: 201, headers: { 'x-request-id': requestId } },
  );
}

export async function GET(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...VARIANT_ADMIN_ROLES]);
  if (!access.ok) return access.response;
  const credits = new CreditRepository(prisma);
  const balances = await credits.getBalances(workspaceId);
  const events = await credits.listEvents(workspaceId, 100);
  return NextResponse.json(
    {
      balances,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        microunits: Number(e.microunits),
        note: e.note,
        attemptId: e.attemptId,
        runId: e.runId,
        createdAt: e.createdAt.toISOString(),
      })),
    },
    { headers: { 'x-request-id': requestId } },
  );
}
