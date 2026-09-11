import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { sniffImageMime } from '@studio/domain';
import { sha256Hex } from '../src/hash.js';

describe('imaging helpers', () => {
  it('produces sRGB png and webp thumbnail from synthetic image', async () => {
    const png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 240, g: 240, b: 240 } },
    })
      .png()
      .toBuffer();
    expect(sniffImageMime(png)).toBe('image/png');
    const normalized = await sharp(png).toColorspace('srgb').png().toBuffer();
    const thumb = await sharp(normalized)
      .resize({ width: 32, height: 32, fit: 'inside' })
      .webp()
      .toBuffer();
    expect(thumb.length).toBeGreaterThan(0);
    expect(sha256Hex(png)).toHaveLength(64);
  });
});
