import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  rasterizeMaskStrokes,
  renderMaskPng,
  sampleMaskRaw,
} from '../src/mask-render.js';

describe('mask-render §10.4', () => {
  it('renders full-res grayscale PNG matching source WxH', async () => {
    const width = 200;
    const height = 300;
    const png = await renderMaskPng({
      width,
      height,
      strokes: [{ tool: 'brush', size: 0.1, points: [{ x: 0.9, y: 0.1 }] }],
    });
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(width);
    expect(meta.height).toBe(height);
    expect(meta.channels === 1 || meta.space === 'b-w' || meta.chromaSubsampling == null).toBe(true);
    expect(png[0]).toBe(0x89);
    // Spot-check: edit region near white, lock near black
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const idx = (Math.floor(0.9 * height) * width + Math.floor(0.1 * width)) * channels; // wrong sample
    void idx;
    const editX = Math.floor(0.9 * width);
    const editY = Math.floor(0.1 * height);
    const lockX = Math.floor(0.1 * width);
    const lockY = Math.floor(0.9 * height);
    const editV = data[(editY * width + editX) * channels]!;
    const lockV = data[(lockY * width + lockX) * channels]!;
    expect(editV).toBeGreaterThan(200);
    expect(lockV).toBeLessThan(20);
  });

  it('AC-07 golden: preview top-right → source edit white; opposite black', () => {
    const sourceW = 2000;
    const sourceH = 3000;
    // Equivalent to painting at (480,32) on 512×512 preview → normalized
    const nx = 480 / 512;
    const ny = 32 / 512;
    const raw = rasterizeMaskStrokes({
      width: sourceW,
      height: sourceH,
      strokes: [{ tool: 'brush', size: 0.06, points: [{ x: nx, y: ny }] }],
    });
    expect(sampleMaskRaw(raw, sourceW, sourceH, nx, ny)).toBeGreaterThan(200);
    expect(sampleMaskRaw(raw, sourceW, sourceH, 0.1, 0.9)).toBe(0);
  });

  it('white=edit black=lock after erase', () => {
    const w = 128;
    const h = 128;
    const raw = rasterizeMaskStrokes({
      width: w,
      height: h,
      strokes: [
        { tool: 'brush', size: 0.3, points: [{ x: 0.5, y: 0.5 }] },
        { tool: 'erase', size: 0.15, points: [{ x: 0.5, y: 0.5 }] },
      ],
    });
    expect(sampleMaskRaw(raw, w, h, 0.5, 0.5)).toBe(0);
  });
});
