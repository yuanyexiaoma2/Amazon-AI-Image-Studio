import { NextResponse, type NextRequest } from 'next/server';

/** Request ID middleware stub (W1-07). Edge-safe (no node:crypto). */
export function middleware(request: NextRequest) {
  const existing = request.headers.get('x-request-id');
  const requestId =
    existing && existing.trim() ? existing.trim() : globalThis.crypto.randomUUID();
  const response = NextResponse.next();
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
