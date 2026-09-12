/**
 * Render normalized mask strokes → full-res grayscale PNG (spec §10.4).
 * White = edit region; black = locked. Matches source Asset Version WxH.
 */
import sharp from 'sharp';
import {
  brushRadiusPx,
  denormalizePoint,
  type MaskStroke,
} from '@studio/domain';

export type RenderMaskInput = {
  strokes: MaskStroke[];
  width: number;
  height: number;
};

function paintDisk(
  buf: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  value: number,
  feather: number,
) {
  const r = Math.max(0.5, radius);
  const featherPx = Math.max(0, feather) * r;
  const hardR = Math.max(0, r - featherPx);
  const minX = Math.max(0, Math.floor(cx - r - 1));
  const maxX = Math.min(width - 1, Math.ceil(cx + r + 1));
  const minY = Math.max(0, Math.floor(cy - r - 1));
  const maxY = Math.min(height - 1, Math.ceil(cy + r + 1));
  const r2 = r * r;
  const hardR2 = hardR * hardR;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      let v = value;
      if (featherPx > 0 && d2 > hardR2) {
        const d = Math.sqrt(d2);
        const t = (r - d) / featherPx;
        const alpha = Math.max(0, Math.min(1, t));
        const idx = y * width + x;
        const prev = buf[idx]!;
        if (value >= 128) {
          buf[idx] = Math.round(prev + (255 - prev) * alpha);
        } else {
          buf[idx] = Math.round(prev * (1 - alpha));
        }
        continue;
      }
      buf[y * width + x] = v;
    }
  }
}

function paintSegment(
  buf: Uint8Array,
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  value: number,
  feather: number,
) {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.35)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    paintDisk(buf, width, height, ax + (bx - ax) * t, ay + (by - ay) * t, radius, value, feather);
  }
}

/** Build raw grayscale buffer (0=lock, 255=edit). */
export function rasterizeMaskStrokes(input: RenderMaskInput): Uint8Array {
  const { width, height, strokes } = input;
  if (width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Error(`Invalid mask dimensions ${width}x${height}`);
  }
  const buf = new Uint8Array(width * height); // black = lock
  for (const stroke of strokes) {
    const radius = brushRadiusPx(stroke.size, width, height);
    const value = stroke.tool === 'brush' ? 255 : 0;
    const feather = stroke.feather ?? 0;
    const pts = stroke.points;
    if (pts.length === 0) continue;
    for (let i = 0; i < pts.length; i++) {
      const p = denormalizePoint(pts[i]!.x, pts[i]!.y, width, height);
      if (i === 0) {
        paintDisk(buf, width, height, p.x, p.y, radius, value, feather);
      } else {
        const prev = denormalizePoint(pts[i - 1]!.x, pts[i - 1]!.y, width, height);
        paintSegment(buf, width, height, prev.x, prev.y, p.x, p.y, radius, value, feather);
      }
    }
  }
  return buf;
}

/** Encode grayscale buffer as PNG (8-bit gray). */
export async function renderMaskPng(input: RenderMaskInput): Promise<Buffer> {
  const raw = rasterizeMaskStrokes(input);
  return sharp(Buffer.from(raw), {
    raw: { width: input.width, height: input.height, channels: 1 },
  })
    .greyscale()
    .png({ palette: false })
    .toBuffer();
}

/** Sample pixel (0–255) at normalized coords after rasterization. */
export function sampleMaskRaw(
  raw: Uint8Array,
  width: number,
  height: number,
  nx: number,
  ny: number,
): number {
  const x = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));
  return raw[y * width + x]!;
}
