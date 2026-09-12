import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { analyzeQaPixels } from '../src/qa-metrics.js';
import { buildStoredZip } from '../src/zip-store.js';
import { sha256Hex } from '../src/hash.js';

describe('W6-02 pixel metrics', () => {
  it('white canvas + centered dark subject passes white/extent/margin', async () => {
    const size = 400;
    const subject = 340;
    const origin = Math.floor((size - subject) / 2);
    const buf = await sharp({
      create: { width: size, height: size, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: subject, height: subject, channels: 3, background: { r: 40, g: 40, b: 40 } },
          })
            .png()
            .toBuffer(),
          left: origin,
          top: origin,
        },
      ])
      .png()
      .toBuffer();
    const m = await analyzeQaPixels({ bytes: buf, haloAt2k: 5 });
    expect(m.decodable).toBe(true);
    expect(m.mime).toBe('image/png');
    expect(m.shortSide).toBe(400);
    expect(m.backgroundWhiteRatio).toBeGreaterThan(0.995);
    expect(m.subjectExtent).toBeGreaterThan(0.84);
    expect(m.minEdgeMarginRatio).toBeGreaterThan(0.01);
    expect(m.touchesEdge).toBe(false);
    expect(m.hasBorder).toBe(false);
    expect(m.blurScore).toBeGreaterThan(40);
  });

  it('red background fails white ratio', async () => {
    const buf = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 20, b: 20 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 160, height: 160, channels: 3, background: { r: 30, g: 30, b: 30 } },
          })
            .png()
            .toBuffer(),
          left: 20,
          top: 20,
        },
      ])
      .png()
      .toBuffer();
    const m = await analyzeQaPixels({ bytes: buf });
    expect(m.backgroundWhiteRatio).toBeLessThan(0.98);
  });

  it('ZIP STORE is deterministic for same createdAt', () => {
    const t = new Date('2026-09-12T00:00:00.000Z');
    const a = buildStoredZip([{ path: 'a.txt', bytes: Buffer.from('hello') }], t);
    const b = buildStoredZip([{ path: 'a.txt', bytes: Buffer.from('hello') }], t);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(a.subarray(0, 2).toString()).toBe('PK');
  });
});
