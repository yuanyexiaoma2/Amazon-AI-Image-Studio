import sharp from 'sharp';

let cached: { bytes: Buffer; width: number; height: number } | null = null;

/** Cached 2000×2000 white PNG for Fake variant batch (ADR-0003). */
export async function produceVariantFakeImage(): Promise<{
  bytes: Buffer;
  width: number;
  height: number;
}> {
  if (cached) return cached;
  const bytes = await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
  cached = { bytes, width: 2000, height: 2000 };
  return cached;
}
