import { NextResponse } from 'next/server';
import { RegisterRequestSchema } from '@studio/contracts';
import { makeApiError } from '@studio/contracts';
import { prisma, UserRepository } from '@studio/db';
import { hashPassword } from '@/lib/password';
import { getOrCreateRequestId } from '@/lib/request-id';

export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const parsed = RegisterRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid registration payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const users = new UserRepository(prisma);
  const existing = await users.findByEmail(parsed.data.email);
  if (existing) {
    return NextResponse.json(
      makeApiError('CONFLICT', 'Email already registered', requestId),
      { status: 409, headers: { 'x-request-id': requestId } },
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const { user } = await users.createWithDefaultWorkspace({
    email: parsed.data.email,
    passwordHash,
    name: parsed.data.name ?? null,
  });

  return NextResponse.json(
    { id: user.id, email: user.email, name: user.name },
    { status: 201, headers: { 'x-request-id': requestId } },
  );
}
