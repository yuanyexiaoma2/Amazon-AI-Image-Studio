import { describe, expect, it } from 'vitest';
import { FakeImageProvider } from '../src/fake.js';

describe('FakeImageProvider', () => {
  it('returns a success image for a valid prompt', async () => {
    const p = new FakeImageProvider();
    const result = await p.generate({
      prompt: 'white background product mug',
      width: 2000,
      height: 2000,
    });
    expect(result.provider).toBe('fake');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mimeType).toBe('image/png');
    expect(result.images[0]?.bytes.length).toBeGreaterThan(0);
  });

  it('rejects empty prompt', async () => {
    const p = new FakeImageProvider();
    await expect(p.generate({ prompt: '', width: 1, height: 1 })).rejects.toThrow(/prompt/);
  });
});
