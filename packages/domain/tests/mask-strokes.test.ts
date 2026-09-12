import { describe, expect, it } from 'vitest';
import {
  brushRadiusPx,
  denormalizePoint,
  isEditRegionAt,
  mapPreviewToSource,
  normalizePoint,
  validateStrokesJson,
} from '../src/mask-strokes.js';

describe('mask strokes §10.4 / AC-07', () => {
  it('normalizes and denormalizes round-trip', () => {
    const n = normalizePoint(128, 64, 512, 256);
    expect(n.x).toBeCloseTo(0.25, 6);
    expect(n.y).toBeCloseTo(0.25, 6);
    const p = denormalizePoint(n.x, n.y, 2000, 1000);
    expect(p.x).toBeCloseTo(500, 5);
    expect(p.y).toBeCloseTo(250, 5);
  });

  it('AC-07: 512 preview top-right maps to 2000×3000 top-right', () => {
    // paint near top-right corner on 512×512 preview
    const preview = mapPreviewToSource(480, 32, 512, 512, 2000, 3000);
    expect(preview.x).toBeCloseTo((480 / 512) * 2000, 5);
    expect(preview.y).toBeCloseTo((32 / 512) * 3000, 5);
    // should be in the upper-right quadrant of source
    expect(preview.x).toBeGreaterThan(1500);
    expect(preview.y).toBeLessThan(500);
  });

  it('same normalized stroke is edit on 1K/2K/4K', () => {
    const stroke = {
      tool: 'brush' as const,
      size: 0.08,
      points: [{ x: 0.9, y: 0.1 }],
    };
    for (const [w, h] of [
      [1024, 1024],
      [2048, 2048],
      [4096, 4096],
      [2000, 3000],
    ] as const) {
      expect(isEditRegionAt([stroke], 0.9, 0.1, w, h)).toBe(true);
      expect(isEditRegionAt([stroke], 0.1, 0.9, w, h)).toBe(false);
    }
  });

  it('erase over brush clears edit region', () => {
    const strokes = [
      { tool: 'brush' as const, size: 0.2, points: [{ x: 0.5, y: 0.5 }] },
      { tool: 'erase' as const, size: 0.2, points: [{ x: 0.5, y: 0.5 }] },
    ];
    expect(isEditRegionAt(strokes, 0.5, 0.5, 1000, 1000)).toBe(false);
  });

  it('brushRadius scales with min edge', () => {
    expect(brushRadiusPx(0.1, 1000, 2000)).toBeCloseTo(50, 5);
    expect(brushRadiusPx(0.1, 2000, 1000)).toBeCloseTo(50, 5);
  });

  it('validateStrokesJson rejects out-of-range', () => {
    const bad = validateStrokesJson([{ tool: 'brush', size: 2, points: [{ x: 0, y: 0 }] }]);
    expect(bad.ok).toBe(false);
    const good = validateStrokesJson([
      { tool: 'brush', size: 0.05, points: [{ x: 0.2, y: 0.3 }] },
    ]);
    expect(good.ok).toBe(true);
  });
});
