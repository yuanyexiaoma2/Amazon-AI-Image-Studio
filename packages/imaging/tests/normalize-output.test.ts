import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  normalizeProviderImageOutput,
  shouldNormalizeNodeOutput,
} from '../src/normalize-output.js';

describe('W5-07 normalizeProviderImageOutput', () => {
  it('flags upscale/outpaint for normalize', () => {
    expect(shouldNormalizeNodeOutput('upscale')).toBe(true);
    expect(shouldNormalizeNodeOutput('outpaint')).toBe(true);
    expect(shouldNormalizeNodeOutput('generate')).toBe(false);
  });

  it('resizes to exact WxH PNG', async () => {
    const src = await sharp({
      create: { width: 32, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const out = await normalizeProviderImageOutput(src, { width: 128, height: 64, format: 'png' });
    expect(out.mimeType).toBe('image/png');
    expect(out.width).toBe(128);
    expect(out.height).toBe(64);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(64);
  });
});
