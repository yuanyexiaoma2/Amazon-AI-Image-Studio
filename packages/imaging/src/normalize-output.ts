/**
 * W5-07 — normalize provider image outputs to PNG + exact WxH (upscale / outpaint).
 */
import sharp from 'sharp';

export type NormalizeImageSpec = {
  width: number;
  height: number;
  /** Always PNG for Studio ingest unless caller overrides. */
  format?: 'png' | 'jpeg' | 'webp';
};

export type NormalizedImageBytes = {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
};

/**
 * Force PNG (default) at exact target dimensions. Pads with black if needed via cover fit.
 */
export async function normalizeProviderImageOutput(
  inputBytes: Buffer,
  spec: NormalizeImageSpec,
): Promise<NormalizedImageBytes> {
  const width = Math.max(1, Math.round(spec.width));
  const height = Math.max(1, Math.round(spec.height));
  const format = spec.format ?? 'png';
  let pipeline = sharp(inputBytes, { failOn: 'none' }).resize({
    width,
    height,
    fit: 'fill',
    withoutEnlargement: false,
  });
  if (format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: 92 });
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality: 92 });
  } else {
    pipeline = pipeline.png();
  }
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const mimeType =
    format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  return {
    bytes: data,
    mimeType,
    width: info.width,
    height: info.height,
  };
}

/** Node types that should always ingest as normalized PNG at request WxH. */
export function shouldNormalizeNodeOutput(nodeType: string): boolean {
  return nodeType === 'upscale' || nodeType === 'outpaint';
}
