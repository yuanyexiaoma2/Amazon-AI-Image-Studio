/** Upload / asset domain rules (spec §10). */

export const ALLOWED_UPLOAD_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedUploadMime = (typeof ALLOWED_UPLOAD_MIMES)[number];

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_PIXELS = 50_000_000; // decompression-bomb guard
export const PRESIGN_TTL_SECONDS = 15 * 60; // 5–15 min window; use 15
export const THUMBNAIL_MAX_EDGE = 512;

export function isAllowedUploadMime(mime: string): mime is AllowedUploadMime {
  return (ALLOWED_UPLOAD_MIMES as readonly string[]).includes(mime);
}

export function assertUploadLimits(input: {
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
}): void {
  if (!isAllowedUploadMime(input.mime)) {
    throw new Error(`MIME not allowed: ${input.mime}`);
  }
  if (input.bytes <= 0 || input.bytes > MAX_UPLOAD_BYTES) {
    throw new Error(`File size out of range (max ${MAX_UPLOAD_BYTES} bytes)`);
  }
  if (input.width != null && input.height != null) {
    const pixels = input.width * input.height;
    if (pixels <= 0 || pixels > MAX_PIXELS) {
      throw new Error(`Pixel count out of range (max ${MAX_PIXELS})`);
    }
  }
}

/** Magic-byte MIME sniff (do not trust extension / Content-Type alone). */
export function sniffImageMime(buf: Buffer): AllowedUploadMime | null {
  if (buf.length < 12) return null;
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function extensionForMime(mime: AllowedUploadMime): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
  }
}

export function buildAssetObjectKey(parts: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  kind: 'original' | 'normalized' | 'thumbnails' | 'masks';
  versionId: string;
  ext: string;
}): string {
  const base = `workspaces/${parts.workspaceId}/projects/${parts.projectId}/assets/${parts.assetId}`;
  if (parts.kind === 'original') return `${base}/original/${parts.versionId}.${parts.ext}`;
  if (parts.kind === 'normalized') return `${base}/normalized/${parts.versionId}.png`;
  if (parts.kind === 'thumbnails') return `${base}/thumbnails/${parts.versionId}-512.webp`;
  return `${base}/masks/${parts.versionId}.png`;
}
