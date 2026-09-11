import { describe, expect, it } from 'vitest';
import { MemoryObjectStorage } from '../src/memory.js';

describe('MemoryObjectStorage', () => {
  it('puts and signs an object', async () => {
    const s = new MemoryObjectStorage();
    await s.putObject({ key: 'a/b.png', body: Buffer.from('x'), contentType: 'image/png' });
    const url = await s.getSignedUrl({ key: 'a/b.png' });
    expect(url).toContain('memory://signed/a/b.png');
  });
});
