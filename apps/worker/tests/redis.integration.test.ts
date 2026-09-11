import { afterAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('Redis health integration', () => {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });

  afterAll(async () => {
    redis.disconnect();
  });

  it('pings Redis successfully', async () => {
    await redis.connect();
    const pong = await redis.ping();
    expect(pong).toBe('PONG');
  });
});
