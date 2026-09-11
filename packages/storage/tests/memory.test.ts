import { describe, expect, it } from 'vitest';
import { MemoryObjectStorage } from '../src/memory.js';

describe('MemoryObjectStorage', () => {
  it('put/get/head/signed put+get', async () => {
    const s = new MemoryObjectStorage();
    await s.putObject({ key: 'a/b.png', body: Buffer.from('hi'), contentType: 'image/png' });
    const got = await s.getObject('a/b.png');
    expect(got.body.toString()).toBe('hi');
    const head = await s.headObject('a/b.png');
    expect(head?.contentLength).toBe(2);
    const putUrl = await s.getSignedPutUrl({ key: 'c.png', contentType: 'image/png' });
    expect(putUrl).toContain('memory://put/');
    const getUrl = await s.getSignedUrl({ key: 'a/b.png' });
    expect(getUrl).toContain('memory://signed/');
  });
});
