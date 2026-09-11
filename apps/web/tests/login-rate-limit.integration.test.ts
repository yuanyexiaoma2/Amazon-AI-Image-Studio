import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import {
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  __setLoginRateLimitRedisForTests,
  checkLoginRateLimit,
  clearLoginFailures,
  deleteLoginFailureKey,
  loginFailureKey,
  recordLoginFailure,
} from '../lib/login-rate-limit';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('login rate limit (Redis)', () => {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  const ip = '203.0.113.50';
  const email = `Rate.Limit+Test@Example.COM`;

  beforeAll(async () => {
    await redis.connect();
    __setLoginRateLimitRedisForTests(redis);
    await deleteLoginFailureKey(ip, email);
  });

  afterAll(async () => {
    await deleteLoginFailureKey(ip, email);
    __setLoginRateLimitRedisForTests(null);
    redis.disconnect();
  });

  it('keys use IP + normalized email', () => {
    expect(loginFailureKey(ip, email)).toBe(`login:fail:${ip}:rate.limit+test@example.com`);
  });

  it('allows under threshold then blocks at max failures', async () => {
    await clearLoginFailures(ip, email);

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX; i++) {
      const count = await recordLoginFailure(ip, email);
      expect(count).toBe(i + 1);
      const check = await checkLoginRateLimit(ip, email);
      if (i + 1 < LOGIN_RATE_LIMIT_MAX) {
        expect(check.limited).toBe(false);
      } else {
        expect(check.limited).toBe(true);
      }
    }

    const blocked = await checkLoginRateLimit(ip, email);
    expect(blocked.limited).toBe(true);
    expect(blocked.count).toBeGreaterThanOrEqual(LOGIN_RATE_LIMIT_MAX);
  });

  it('allows login again after key deleted (simulates window expiry / TTL advance)', async () => {
    // Ensure we are limited first
    await clearLoginFailures(ip, email);
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX; i++) {
      await recordLoginFailure(ip, email);
    }
    expect((await checkLoginRateLimit(ip, email)).limited).toBe(true);

    // Simulate TTL expiry by deleting the key
    await deleteLoginFailureKey(ip, email);
    const after = await checkLoginRateLimit(ip, email);
    expect(after.limited).toBe(false);
    expect(after.count).toBe(0);
  });

  it('sets TTL roughly equal to window on first failure', async () => {
    const otherEmail = `ttl-window-${Date.now()}@example.com`;
    await deleteLoginFailureKey(ip, otherEmail);
    await recordLoginFailure(ip, otherEmail);
    const key = loginFailureKey(ip, otherEmail);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LOGIN_RATE_LIMIT_WINDOW_SECONDS);
    await deleteLoginFailureKey(ip, otherEmail);
  });
});
