import { NextRequest, NextResponse } from 'next/server';
import { makeApiError } from '@studio/contracts';
import { normalizeEmail } from '@studio/domain';
import { handlers, LoginRateLimitedError } from '@/lib/auth';
import { checkLoginRateLimit, getClientIp } from '@/lib/login-rate-limit';
import { getOrCreateRequestId } from '@/lib/request-id';

export const { GET } = handlers;

/**
 * Wrap Auth.js POST so credentials login can return HTTP 429 with a generic
 * message when IP+email failure budget is exhausted (Redis-backed).
 */
export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const url = new URL(request.url);
  const isCredentialsCallback = url.pathname.includes('/callback/credentials');

  if (isCredentialsCallback) {
    let email = '';
    try {
      const cloned = request.clone();
      const form = await cloned.formData();
      email = normalizeEmail(String(form.get('email') ?? ''));
    } catch {
      // Body may be unreadable; authorize still enforces limit.
    }
    const ip = getClientIp(request);
    if (email) {
      const limited = await checkLoginRateLimit(ip, email);
      if (limited.limited) {
        return NextResponse.json(
          makeApiError(
            'RATE_LIMITED',
            'Too many login attempts. Try again later.',
            requestId,
          ),
          {
            status: 429,
            headers: {
              'x-request-id': requestId,
              ...(limited.retryAfterSeconds
                ? { 'retry-after': String(limited.retryAfterSeconds) }
                : {}),
            },
          },
        );
      }
    }
  }

  try {
    return await handlers.POST(request);
  } catch (err) {
    if (err instanceof LoginRateLimitedError) {
      return NextResponse.json(
        makeApiError('RATE_LIMITED', err.message, requestId),
        { status: 429, headers: { 'x-request-id': requestId } },
      );
    }
    throw err;
  }
}
