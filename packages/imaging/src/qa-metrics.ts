/**
 * Deterministic pixel metrics for amazon-main-us-v1 (W6-02).
 * Subject ≈ non-white pixels; background sampled from complement minus scaled halo.
 */

import sharp from 'sharp';
import { sniffImageMime } from '@studio/domain';
import type { QaPixelMetrics } from '@studio/domain';

export type AnalyzeQaPixelsInput = {
  bytes: Buffer;
  /** Halo in pixels at 2000px short side; scaled linearly. */
  haloAt2k?: number;
  channelFloor?: number;
};

function laplacianVar(gray: Buffer, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const c = gray[i] ?? 0;
      const v =
        (gray[i - width] ?? 0) +
        (gray[i + width] ?? 0) +
        (gray[i - 1] ?? 0) +
        (gray[i + 1] ?? 0) -
        4 * c;
      sum += v;
      sumSq += v * v;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export async function analyzeQaPixels(input: AnalyzeQaPixelsInput): Promise<QaPixelMetrics> {
  const mime = sniffImageMime(input.bytes) ?? 'application/octet-stream';
  let meta;
  try {
    meta = await sharp(input.bytes).metadata();
  } catch {
    return {
      decodable: false,
      mime,
      width: 0,
      height: 0,
      shortSide: 0,
      backgroundWhiteRatio: 0,
      subjectExtent: 0,
      maskConfidence: 0,
      minEdgeMarginRatio: 0,
      touchesEdge: true,
      blurScore: 0,
      hasBorder: false,
      subjectBBox: { x: 0, y: 0, width: 1, height: 1 },
    };
  }

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) {
    return {
      decodable: false,
      mime,
      width,
      height,
      shortSide: 0,
      backgroundWhiteRatio: 0,
      subjectExtent: 0,
      maskConfidence: 0,
      minEdgeMarginRatio: 0,
      touchesEdge: true,
      blurScore: 0,
      hasBorder: false,
      subjectBBox: { x: 0, y: 0, width: 1, height: 1 },
    };
  }

  const { data, info } = await sharp(input.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const channels = info.channels;
  const floor = input.channelFloor ?? 250;
  const halo = Math.max(1, Math.round(((input.haloAt2k ?? 5) * Math.min(w, h)) / 2000));

  const gray = Buffer.alloc(w * h);
  const background = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      gray[y * w + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }

  // Corner flood-fill = canvas background (white or colored). Subject = complement.
  const seeds: Array<[number, number]> = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  const stack: number[] = [];
  const seedTol = 18;
  for (const [sx, sy] of seeds) {
    const si = (sy * w + sx) * channels;
    const sr = data[si] ?? 0;
    const sg = data[si + 1] ?? 0;
    const sb = data[si + 2] ?? 0;
    stack.push(sy * w + sx);
    while (stack.length) {
      const idx = stack.pop()!;
      if (background[idx]) continue;
      const x = idx % w;
      const y = Math.floor(idx / w);
      const i = (y * w + x) * channels;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (Math.abs(r - sr) > seedTol || Math.abs(g - sg) > seedTol || Math.abs(b - sb) > seedTol) {
        continue;
      }
      background[idx] = 1;
      if (x > 0) stack.push(idx - 1);
      if (x + 1 < w) stack.push(idx + 1);
      if (y > 0) stack.push(idx - w);
      if (y + 1 < h) stack.push(idx + w);
    }
  }

  const subject = new Uint8Array(w * h);
  let subjectCount = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const i = idx * channels;
      const a = channels > 3 ? (data[i + 3] ?? 255) : 255;
      if (a <= 8 || background[idx]) continue;
      subject[idx] = 1;
      subjectCount += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const hasSubject = subjectCount > 0 && maxX >= minX;
  const bboxW = hasSubject ? maxX - minX + 1 : 0;
  const bboxH = hasSubject ? maxY - minY + 1 : 0;
  const subjectExtent = hasSubject ? Math.max(bboxW / w, bboxH / h) : 0;
  const left = hasSubject ? minX / w : 0.5;
  const top = hasSubject ? minY / h : 0.5;
  const right = hasSubject ? (w - 1 - maxX) / w : 0.5;
  const bottom = hasSubject ? (h - 1 - maxY) / h : 0.5;
  const minEdgeMarginRatio = hasSubject ? Math.min(left, top, right, bottom) : 0;
  const touchesEdge = hasSubject && (minX <= 0 || minY <= 0 || maxX >= w - 1 || maxY >= h - 1);

  let bgTotal = 0;
  let bgWhite = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (subject[y * w + x]) continue;
      if (hasSubject) {
        const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
        const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
        const dist = Math.hypot(dx, dy);
        // Inside bbox holes: treat as near-subject (exclude halo along bbox).
        const inside = x >= minX && x <= maxX && y >= minY && y <= maxY;
        if (inside || dist <= halo) continue;
      }
      const i = (y * w + x) * channels;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      bgTotal += 1;
      if (r >= floor && g >= floor && b >= floor) bgWhite += 1;
    }
  }
  const backgroundWhiteRatio = bgTotal === 0 ? (hasSubject ? 1 : 0) : bgWhite / bgTotal;

  const coverage = subjectCount / (w * h);
  const maskConfidence = !hasSubject ? 0.2 : coverage < 0.01 ? 0.55 : coverage > 0.98 ? 0.6 : 0.95;

  // Border: dark/colored band along the outer 2% frame that is not the subject core.
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.02));
  let bandPx = 0;
  let bandDark = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onBand = x < band || y < band || x >= w - band || y >= h - band;
      if (!onBand) continue;
      bandPx += 1;
      const i = (y * w + x) * channels;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const maxc = Math.max(r, g, b);
      if (maxc < 40) bandDark += 1;
    }
  }
  const hasBorder = bandPx > 0 && bandDark / bandPx > 0.45;

  return {
    decodable: true,
    mime,
    width,
    height,
    shortSide: Math.min(width, height),
    backgroundWhiteRatio,
    subjectExtent,
    maskConfidence,
    minEdgeMarginRatio,
    touchesEdge,
    blurScore: laplacianVar(gray, w, h),
    hasBorder,
    subjectBBox: hasSubject
      ? { x: minX / w, y: minY / h, width: bboxW / w, height: bboxH / h }
      : { x: 0, y: 0, width: 1, height: 1 },
  };
}
