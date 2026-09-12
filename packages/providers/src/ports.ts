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

export type VisionExtractRequest = {
  /** Opaque hints from product / SKU context (Fake Provider uses these). */
  sku?: string;
  category?: string;
  marketplace?: string;
  /** Optional text cues derived from filenames or prior facts. */
  hints?: string[];
  /** Asset version ids used as evidence refs (not fetched by Fake Provider). */
  assetVersionIds: string[];
};

export type ExtractedFact = {
  key: string;
  value: unknown;
  confidence: number;
  evidenceAssetVersionIds: string[];
};

export type VisionExtractResult = {
  provider: string;
  modelId: string;
  facts: ExtractedFact[];
  locks: string[];
  allowedChanges: string[];
  latencyMs: number;
};

/** Vision / structured fact extraction port (W2-05). */
export interface VisionProvider {
  readonly name: string;
  extractFacts(request: VisionExtractRequest): Promise<VisionExtractResult>;
}

export type ShotPlanDraftRequest = {
  sku?: string;
  category?: string;
  marketplace?: string;
  /** Confirmed truth facts used to flavor copy / constraints. */
  confirmedFacts?: Array<{ key: string; value: unknown }>;
  /** Include PACKAGE slot (not in default 7). */
  includePackage?: boolean;
};

export type PlannedShotBrief = {
  slot: 'MAIN' | 'FEATURE' | 'DETAIL' | 'DIMENSION' | 'LIFESTYLE' | 'PACKAGE';
  purpose: string;
  orderIndex: number;
  aspectRatio: string;
  targetPixels: { width: number; height: number };
  copy: unknown[];
  must: string[];
  mustNot: string[];
  qaPolicy: string;
};

export type ShotPlanDraftResult = {
  provider: string;
  modelId: string;
  briefs: PlannedShotBrief[];
  latencyMs: number;
};

/** Shot Plan planner port (W3-02). */
export interface ShotPlanProvider {
  readonly name: string;
  draftPlan(request: ShotPlanDraftRequest): Promise<ShotPlanDraftResult>;
}
