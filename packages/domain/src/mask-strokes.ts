/**
 * Mask stroke model + coordinate mapping — spec §10.4 / AC-07.
 * Pure domain: normalized [0,1]×[0,1] storage; render happens in @studio/imaging.
 */

export const MASK_COORDINATE_SPACE = 'normalized_0_1' as const;

export type MaskTool = 'brush' | 'erase';

/** One continuous stroke; points are normalized [0,1]×[0,1] (origin top-left). */
export type MaskStroke = {
  tool: MaskTool;
  /**
   * Brush diameter as a fraction of min(sourceWidth, sourceHeight).
   * Example: 0.05 ≈ 5% of the shorter edge.
   */
  size: number;
  points: Array<{ x: number; y: number }>;
  /** Optional feather as fraction of brush radius (0 = hard). */
  feather?: number;
};

export type MaskStrokeDocument = {
  strokes: MaskStroke[];
  coordinateSpace: typeof MASK_COORDINATE_SPACE;
  sourceWidth: number;
  sourceHeight: number;
  /** Editor viewport version / zoom used when painting (audit). */
  viewportVersion?: number;
  zoom?: number;
  featherDefault?: number;
};

export type PixelPoint = { x: number; y: number };

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function normalizePoint(px: number, py: number, width: number, height: number): PixelPoint {
  if (width <= 0 || height <= 0) return { x: 0, y: 0 };
  return { x: clamp01(px / width), y: clamp01(py / height) };
}

export function denormalizePoint(
  nx: number,
  ny: number,
  width: number,
  height: number,
): PixelPoint {
  return {
    x: clamp01(nx) * width,
    y: clamp01(ny) * height,
  };
}

/** Brush radius in source pixels from normalized diameter. */
export function brushRadiusPx(normalizedSize: number, sourceWidth: number, sourceHeight: number): number {
  const m = Math.min(sourceWidth, sourceHeight);
  return Math.max(0.5, (clamp01(normalizedSize) * m) / 2);
}

/**
 * Map a preview-canvas paint point to source pixels via normalized coords.
 * Guarantees AC-07: same normalized region on any resolution.
 */
export function mapPreviewToSource(
  previewX: number,
  previewY: number,
  previewWidth: number,
  previewHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): PixelPoint {
  const n = normalizePoint(previewX, previewY, previewWidth, previewHeight);
  return denormalizePoint(n.x, n.y, sourceWidth, sourceHeight);
}

export function validateStroke(stroke: MaskStroke): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (stroke.tool !== 'brush' && stroke.tool !== 'erase') {
    issues.push('tool must be brush|erase');
  }
  if (!(stroke.size > 0 && stroke.size <= 1)) {
    issues.push('size must be in (0,1]');
  }
  if (!Array.isArray(stroke.points) || stroke.points.length === 0) {
    issues.push('points required');
  } else {
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i]!;
      if (typeof p.x !== 'number' || typeof p.y !== 'number') {
        issues.push(`points[${i}] invalid`);
        continue;
      }
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
        issues.push(`points[${i}] out of [0,1]`);
      }
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true };
}

export function validateStrokesJson(
  raw: unknown,
): { ok: true; strokes: MaskStroke[] } | { ok: false; issues: string[] } {
  if (!Array.isArray(raw)) return { ok: false, issues: ['strokes must be an array'] };
  const strokes: MaskStroke[] = [];
  const issues: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] as MaskStroke;
    const v = validateStroke(s);
    if (!v.ok) {
      for (const issue of v.issues) issues.push(`strokes[${i}]: ${issue}`);
    } else {
      strokes.push({
        tool: s.tool,
        size: s.size,
        points: s.points.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })),
        feather: typeof s.feather === 'number' ? Math.max(0, Math.min(1, s.feather)) : undefined,
      });
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, strokes };
}

/**
 * Sample whether a normalized point is inside any brush (edit) region after
 * applying erase-over-brush order. Used by golden tests (no raster needed).
 */
export function isEditRegionAt(
  strokes: MaskStroke[],
  nx: number,
  ny: number,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  const px = denormalizePoint(nx, ny, sourceWidth, sourceHeight);
  let edit = false;
  for (const stroke of strokes) {
    const r = brushRadiusPx(stroke.size, sourceWidth, sourceHeight);
    const r2 = r * r;
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i]!;
      const sp = denormalizePoint(p.x, p.y, sourceWidth, sourceHeight);
      const dx = px.x - sp.x;
      const dy = px.y - sp.y;
      if (dx * dx + dy * dy <= r2) {
        edit = stroke.tool === 'brush';
      }
      // Cover segment between points
      if (i > 0) {
        const prev = stroke.points[i - 1]!;
        const a = denormalizePoint(prev.x, prev.y, sourceWidth, sourceHeight);
        if (distToSegment2(px.x, px.y, a.x, a.y, sp.x, sp.y) <= r2) {
          edit = stroke.tool === 'brush';
        }
      }
    }
  }
  return edit;
}

function distToSegment2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return apx * apx + apy * apy;
  let t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}
