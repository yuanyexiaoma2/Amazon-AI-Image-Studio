import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProvider,
  VisionExtractRequest,
  VisionExtractResult,
  VisionProvider,
} from './ports.js';

/**
 * Fake Provider — default until real API keys are authorized (W0-02 / ADR-0001).
 * Returns a tiny valid 1x1 PNG so pipelines can run offline.
 * NEVER requires or reads real API keys.
 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export class FakeImageProvider implements ImageProvider {
  readonly name = 'fake';

  async generate(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const started = Date.now();
    if (!request.prompt || request.prompt.trim().length === 0) {
      throw new Error('prompt is required');
    }
    return {
      provider: this.name,
      modelId: 'fake-v1',
      images: [
        {
          bytes: TINY_PNG,
          mimeType: 'image/png',
          width: request.width || 1,
          height: request.height || 1,
        },
      ],
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Fake Vision Provider — deterministic structured facts for Truth Pack extract (W2-05).
 * Uses SKU / category hints only; does not call external APIs.
 */
export class FakeVisionProvider implements VisionProvider {
  readonly name = 'fake-vision';

  async extractFacts(request: VisionExtractRequest): Promise<VisionExtractResult> {
    const started = Date.now();
    if (!request.assetVersionIds.length) {
      throw new Error('assetVersionIds required');
    }
    const sku = request.sku ?? 'UNKNOWN-SKU';
    const evidence = [...request.assetVersionIds];
    const brandGuess =
      request.hints?.find((h) => h.toLowerCase().startsWith('brand:'))?.slice(6).trim() ||
      sku.split('-')[0] ||
      'Acme';

    const facts = [
      {
        key: 'brand',
        value: brandGuess,
        confidence: 0.72,
        evidenceAssetVersionIds: evidence,
      },
      {
        key: 'productType',
        value: request.category ?? 'general merchandise',
        confidence: 0.65,
        evidenceAssetVersionIds: evidence,
      },
      {
        key: 'sku',
        value: sku,
        confidence: 0.99,
        evidenceAssetVersionIds: evidence,
      },
      {
        key: 'marketplace',
        value: request.marketplace ?? 'US',
        confidence: 0.99,
        evidenceAssetVersionIds: evidence,
      },
      {
        key: 'printedText',
        value: [brandGuess.toUpperCase()],
        confidence: 0.55,
        evidenceAssetVersionIds: evidence,
      },
    ];

    return {
      provider: this.name,
      modelId: 'fake-vision-v1',
      facts,
      locks: [
        'body silhouette',
        'logo spelling and placement',
        'number of included items',
      ],
      allowedChanges: ['background', 'surface', 'ambient lighting'],
      latencyMs: Date.now() - started,
    };
  }
}
