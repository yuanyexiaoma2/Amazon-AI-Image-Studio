import Redis from 'ioredis';
import { normalizeEmail } from '@studio/domain';

/** Max failed login attempts per IP + normalized email within the window. */
export const LOGIN_RATE_LIMIT_MAX = 5;
/** Sliding/fixed window length in seconds (15 minutes). */
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

const KEY_PREFIX = 'login:fail:';

let redisSingleton: Redis | null = null;

export function getLoginRateLimitRedis(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): Redis {
  if (!redisSingleton) {
    redisSingleton = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  return redisSingleton;
}

/** Test helper: replace / disconnect the singleton. */
export function __setLoginRateLimitRedisForTests(client: Redis | null): void {
  if (redisSingleton && redisSingleton !== client) {
    try {
      redisSingleton.disconnect();
    } catch {
      // ignore
    }
  }
  redisSingleton = client;
}

export function loginFailureKey(ip: string, email: string): string {
  const normalized = normalizeEmail(email);
  const safeIp = (ip || 'unknown').trim() || 'unknown';
  return `${KEY_PREFIX}${safeIp}:${normalized}`;
}

export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'unknown';
}

export type RateLimitCheck = {
  limited: boolean;
  count: number;
  retryAfterSeconds?: number;
};

/**
 * Returns whether login attempts for IP+email are currently rate-limited.
 * Fail-open if Redis is unavailable (log path only — still allow auth attempt).
 */
export async function checkLoginRateLimit(ip: string, email: string): Promise<RateLimitCheck> {
  const key = loginFailureKey(ip, email);
  try {
    const redis = getLoginRateLimitRedis();
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect();
    }
    const raw = await redis.get(key);
    const count = raw ? Number.parseInt(raw, 10) : 0;
    if (Number.isFinite(count) && count >= LOGIN_RATE_LIMIT_MAX) {
      const ttl = await redis.ttl(key);
      return {
        limited: true,
        count,
        retryAfterSeconds: ttl > 0 ? ttl : LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      };
    }
    return { limited: false, count: Number.isFinite(count) ? count : 0 };
  } catch {
    return { limited: false, count: 0 };
  }
}

/** Record a failed login (unknown email, bad password, inactive). */
export async function recordLoginFailure(ip: string, email: string): Promise<number> {
  const key = loginFailureKey(ip, email);
  try {
    const redis = getLoginRateLimitRedis();
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect();
    }
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, LOGIN_RATE_LIMIT_WINDOW_SECONDS);
    }
    return count;
  } catch {
    return 0;
  }
}

/** Clear failures after a successful login. */
export async function clearLoginFailures(ip: string, email: string): Promise<void> {
  const key = loginFailureKey(ip, email);
  try {
    const redis = getLoginRateLimitRedis();
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect();
    }
    await redis.del(key);
  } catch {
    // ignore
  }
}

/** Test helper: delete the rate-limit key (simulate window expiry). */
export async function deleteLoginFailureKey(ip: string, email: string): Promise<void> {
  await clearLoginFailures(ip, email);
}
