export type GenerateImageRequest = {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  referenceImageUrls?: string[];
  seed?: number;
};

export type GenerateImageResult = {
  provider: string;
  modelId: string;
  images: Array<{ bytes: Buffer; mimeType: string; width: number; height: number }>;
  latencyMs: number;
};

/** Image generation / edit provider port. */
export interface ImageProvider {
  readonly name: string;
  generate(request: GenerateImageRequest): Promise<GenerateImageResult>;
}
