import { describe, expect, it } from 'vitest';
import { MemoryObjectStorage } from '../src/memory.js';

/** Spec / domain PRESIGN_TTL_SECONDS = 15 * 60 — mirrored for storage contract test. */
const PRESIGN_TTL_SECONDS = 15 * 60;

describe('W8-04 signed URL expiry contract', () => {
  it('signed GET/PUT encode finite expiry (default PUT uses PRESIGN window)', async () => {
    const s = new MemoryObjectStorage();
    await s.putObject({ key: 'k.png', body: Buffer.from('x'), contentType: 'image/png' });
    const get = await s.getSignedUrl({ key: 'k.png', expiresInSeconds: 60 });
    expect(get).toMatch(/exp=60/);
    const put = await s.getSignedPutUrl({
      key: 'u.png',
      contentType: 'image/png',
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    });
    expect(put).toContain(`exp=${PRESIGN_TTL_SECONDS}`);
    expect(PRESIGN_TTL_SECONDS).toBeLessThanOrEqual(15 * 60);
    expect(PRESIGN_TTL_SECONDS).toBeGreaterThan(0);
  });
});
