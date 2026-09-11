import type { GenerateImageRequest, GenerateImageResult, ImageProvider } from './ports.js';

/**
 * Fake Provider — default until real API keys are authorized (W0-02 / ADR-0001).
 * Returns a tiny valid 1x1 PNG so pipelines can run offline.
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
