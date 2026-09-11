import { randomUUID } from 'node:crypto';

export function getOrCreateRequestId(headerValue: string | null): string {
  if (headerValue && headerValue.trim().length > 0) return headerValue.trim();
  return randomUUID();
}
