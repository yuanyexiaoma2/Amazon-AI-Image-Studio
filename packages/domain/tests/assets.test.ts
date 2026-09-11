import { describe, expect, it } from 'vitest';
import {
  assertUploadLimits,
  buildAssetObjectKey,
  isAllowedUploadMime,
  isAnimatedOrDynamicWebp,
  normalizeContentType,
  sniffImageMime,
  MAX_UPLOAD_BYTES,
} from '../src/assets.js';

describe('asset upload rules', () => {
  it('allows png/jpeg/webp only', () => {
    expect(isAllowedUploadMime('image/png')).toBe(true);
    expect(isAllowedUploadMime('image/gif')).toBe(false);
  });

  it('rejects oversized uploads', () => {
    expect(() =>
      assertUploadLimits({ mime: 'image/png', bytes: MAX_UPLOAD_BYTES + 1 }),
    ).toThrow(/size/);
  });

  it('rejects decompression-bomb pixel counts', () => {
    expect(() =>
      assertUploadLimits({ mime: 'image/png', bytes: 100, width: 10000, height: 10000 }),
    ).toThrow(/Pixel/);
  });

  it('sniffs PNG magic', () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    expect(sniffImageMime(png)).toBe('image/png');
  });

  it('builds storage keys without user filenames', () => {
    const key = buildAssetObjectKey({
      workspaceId: 'w',
      projectId: 'p',
      assetId: 'a',
      kind: 'original',
      versionId: 'v',
      ext: 'png',
    });
    expect(key).toBe('workspaces/w/projects/p/assets/a/original/v.png');
  });

  it('detects ANIM chunk', () => {
    const buf = Buffer.alloc(40);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(32, 4);
    buf.write('WEBP', 8);
    buf.write('ANIM', 12);
    expect(isAnimatedOrDynamicWebp(buf)).toBe(true);
  });

  it('static webp without ANIM is not animated', () => {
    const buf = Buffer.alloc(20);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(12, 4);
    buf.write('WEBP', 8);
    buf.write('VP8 ', 12);
    expect(isAnimatedOrDynamicWebp(buf)).toBe(false);
  });

  it('normalizes content-type', () => {
    expect(normalizeContentType('image/png; charset=binary')).toBe('image/png');
  });
});
