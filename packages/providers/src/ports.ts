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
  /** W3-08 prep: optional asset version refs for later canvas materialize. */
  referencedAssetVersionIds?: string[];
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

/** Fake / real OCR port for QA (W6-03). */
export type OcrInspectRequest = {
  assetVersionId: string;
  scenario?: string;
  confirmedFacts?: Array<{ key: string; value: unknown }>;
};

export type OcrInspectResult = {
  provider: string;
  modelId: string;
  tokens: Array<{
    text: string;
    confidence: number;
    region: { x: number; y: number; width: number; height: number };
    onProductPrint?: boolean;
  }>;
};

export interface OcrProvider {
  readonly name: string;
  inspect(request: OcrInspectRequest): Promise<OcrInspectResult>;
}

export type VisionQaRequest = {
  assetVersionId: string;
  scenario?: string;
  checks?: string[];
};

export type VisionQaResult = {
  provider: string;
  modelId: string;
  identity: {
    geometry: 'MATCH' | 'REVIEW' | 'FAIL';
    logo: 'MATCH' | 'REVIEW' | 'FAIL';
    ports: 'MATCH' | 'REVIEW' | 'FAIL';
    controls: 'MATCH' | 'REVIEW' | 'FAIL';
    material: 'MATCH' | 'REVIEW' | 'FAIL';
    itemCount: 'MATCH' | 'REVIEW' | 'FAIL';
    overall: 'MATCH' | 'REVIEW' | 'FAIL';
    regions: Array<{ x: number; y: number; width: number; height: number }>;
    message?: string;
  };
  soldItems: {
    status: 'PASS' | 'REVIEW' | 'FAIL';
    inventoryConflict: boolean;
    segmentationConflict: boolean;
    message?: string;
    regions: Array<{ x: number; y: number; width: number; height: number }>;
  };
  borderWatermark?: {
    status: 'PASS' | 'REVIEW' | 'FAIL';
    confidence: number;
    regions: Array<{ x: number; y: number; width: number; height: number }>;
    message?: string;
  };
};

export interface VisionQaProvider {
  readonly name: string;
  inspectProduct(request: VisionQaRequest): Promise<VisionQaResult>;
}
