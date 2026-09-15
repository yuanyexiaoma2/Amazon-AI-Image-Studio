import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProvider,
  VisionExtractRequest,
  VisionExtractResult,
  VisionProvider,
  ShotPlanDraftRequest,
  ShotPlanDraftResult,
  ShotPlanProvider,
  OcrInspectRequest,
  OcrInspectResult,
  OcrProvider,
  VisionQaProvider,
  VisionQaRequest,
  VisionQaResult,
} from './ports.js';
import { DEFAULT_SEVEN_IMAGE_TEMPLATE } from '@studio/domain';

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


/**
 * Fake Shot Plan Provider — deterministic 7-image draft from §11.1 template.
 * Never calls external APIs / never reads API keys (W0-02 BLOCKED_EXTERNAL).
 */
export class FakeShotPlanProvider implements ShotPlanProvider {
  readonly name = 'fake-shot-plan';

  async draftPlan(request: ShotPlanDraftRequest): Promise<ShotPlanDraftResult> {
    const started = Date.now();
    const sku = request.sku ?? 'UNKNOWN-SKU';
    const brandFact = request.confirmedFacts?.find((f) => f.key === 'brand');
    const brand =
      typeof brandFact?.value === 'string' && brandFact.value.trim()
        ? brandFact.value.trim()
        : sku.split('-')[0] || 'Acme';

    // V2: weave owner intent deterministically — segments become FEATURE
    // selling points (copy source 'intent'); full intent flavors LIFESTYLE.
    const intentSegments = (request.intent ?? '')
      .split(/[、,，;；。\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 4);
    let featureIdx = 0;

    const briefs = DEFAULT_SEVEN_IMAGE_TEMPLATE.map((t) => {
      const isFeature = t.slot === 'FEATURE';
      const segment = isFeature ? intentSegments[featureIdx++] : undefined;
      return {
        slot: t.slot,
        purpose:
          segment != null
            ? `${t.purpose}: ${segment}`
            : t.slot === 'LIFESTYLE' && request.intent?.trim()
              ? `${t.purpose} — scene from owner intent`
              : t.purpose,
        orderIndex: t.orderIndex,
        aspectRatio: t.aspectRatio,
        targetPixels: { ...t.targetPixels },
        copy:
          segment != null
            ? [{ text: segment.slice(0, 200), source: 'intent' }]
            : t.slot === 'FEATURE'
              ? [{ text: `${brand} highlight`, source: 'fake-planner' }]
              : t.slot === 'DIMENSION'
                ? [{ text: 'Use confirmed dimensions only', source: 'fake-planner' }]
                : [],
        must: [...t.must],
        mustNot: [...t.mustNot],
        qaPolicy: t.qaPolicy,
        referencedAssetVersionIds: [],
      };
    });

    if (request.includePackage) {
      briefs.push({
        slot: 'PACKAGE',
        purpose: "Packaging / what's in the box",
        orderIndex: briefs.length + 1,
        aspectRatio: '1:1',
        targetPixels: { width: 2000, height: 2000 },
        copy: [],
        must: ['show only included pack contents'],
        mustNot: ['unincluded accessory'],
        qaPolicy: 'amazon-package-us-v1',
        referencedAssetVersionIds: [],
      });
    }

    return {
      provider: this.name,
      modelId: 'fake-shot-plan-v1',
      briefs,
      latencyMs: Date.now() - started,
    };
  }
}

function matchIdentity(): VisionQaResult['identity'] {
  return {
    geometry: 'MATCH',
    logo: 'MATCH',
    ports: 'MATCH',
    controls: 'MATCH',
    material: 'MATCH',
    itemCount: 'MATCH',
    overall: 'MATCH',
    regions: [{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }],
    message: 'Fake Vision: identity matches confirmed truth',
  };
}

/**
 * Fake OCR — scenario-driven tokens. Never calls external APIs.
 * SUCCESS: no overlay (optional confirmed brand as on-print).
 */
export class FakeOcrProvider implements OcrProvider {
  readonly name = 'fake-ocr';

  async inspect(request: OcrInspectRequest): Promise<OcrInspectResult> {
    const scenario = (request.scenario ?? 'SUCCESS').toUpperCase();
    const brandFact = request.confirmedFacts?.find((f) => f.key === 'brand');
    const brand = typeof brandFact?.value === 'string' ? brandFact.value : 'Acme';

    if (scenario === 'OVERLAY_TEXT') {
      return {
        provider: this.name,
        modelId: 'fake-ocr-v1',
        tokens: [
          {
            text: 'SALE 50%',
            confidence: 0.95,
            region: { x: 0.08, y: 0.08, width: 0.22, height: 0.1 },
            onProductPrint: false,
          },
        ],
      };
    }
    if (scenario === 'FACT_MISMATCH') {
      return {
        provider: this.name,
        modelId: 'fake-ocr-v1',
        tokens: [
          {
            text: `brand:ACOME`,
            confidence: 0.96,
            region: { x: 0.31, y: 0.42, width: 0.18, height: 0.08 },
            onProductPrint: true,
          },
        ],
      };
    }
    if (scenario === 'LOW_CONFIDENCE') {
      return {
        provider: this.name,
        modelId: 'fake-ocr-v1',
        tokens: [
          {
            text: 'SALE',
            confidence: 0.4,
            region: { x: 0.7, y: 0.05, width: 0.2, height: 0.08 },
            onProductPrint: false,
          },
        ],
      };
    }
    return {
      provider: this.name,
      modelId: 'fake-ocr-v1',
      tokens: [
        {
          text: brand,
          confidence: 0.92,
          region: { x: 0.35, y: 0.45, width: 0.2, height: 0.08 },
          onProductPrint: true,
        },
      ],
    };
  }
}

/**
 * Fake Vision QA — structured identity / sold-items / defects. No real keys.
 */
export class FakeVisionQaProvider implements VisionQaProvider {
  readonly name = 'fake-vision-qa';

  async inspectProduct(request: VisionQaRequest): Promise<VisionQaResult> {
    const scenario = (request.scenario ?? 'SUCCESS').toUpperCase();
    if (scenario === 'STRUCTURE_CHANGE') {
      return {
        provider: this.name,
        modelId: 'fake-vision-qa-v1',
        identity: {
          ...matchIdentity(),
          geometry: 'FAIL',
          overall: 'FAIL',
          message: 'Fake Vision: product structure/geometry drifted from master locks',
        },
        soldItems: { status: 'PASS', inventoryConflict: false, segmentationConflict: false, regions: [] },
      };
    }
    if (scenario === 'LOGO_CHANGE') {
      return {
        provider: this.name,
        modelId: 'fake-vision-qa-v1',
        identity: {
          ...matchIdentity(),
          logo: 'FAIL',
          overall: 'FAIL',
          message: 'Fake Vision: logo changed vs locked master',
        },
        soldItems: { status: 'PASS', inventoryConflict: false, segmentationConflict: false, regions: [] },
      };
    }
    if (scenario === 'COMPOSITION_DRIFT') {
      return {
        provider: this.name,
        modelId: 'fake-vision-qa-v1',
        identity: {
          ...matchIdentity(),
          overall: 'REVIEW',
          message: 'Fake Vision: composition drift needs review',
          regions: [{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }],
        },
        soldItems: { status: 'PASS', inventoryConflict: false, segmentationConflict: false, regions: [] },
      };
    }
    if (scenario === 'ATTACHMENT_COUNT') {
      return {
        provider: this.name,
        modelId: 'fake-vision-qa-v1',
        identity: {
          ...matchIdentity(),
          itemCount: 'REVIEW',
          overall: 'REVIEW',
          message: 'Fake Vision: attachment/item count uncertain vs master',
        },
        soldItems: { status: 'REVIEW', inventoryConflict: false, segmentationConflict: false, regions: [], message: 'item count review' },
      };
    }
    if (scenario === 'IDENTITY_MISMATCH') {

      return {
        provider: this.name,
        modelId: 'fake-vision-qa-v1',
        identity: {
          ...matchIdentity(),
          logo: 'FAIL',
          overall: 'FAIL',
          message: 'Fake Vision: logo / brand mark drifted from confirmed truth',
          regions: [{ x: 0.31, y: 0.42, width: 0.18, height: 0.08 }],
        },
        soldItems: {
          status: 'PASS',
          inventoryConflict: false,
          segmentationConflict: false,
          regions: [],
        },
      };
    }
    if (scenario === 'UNSOLD_ACCESSORY') {
      return {
        provider: this.name,
        modelId: 'fake-vision-qa-v1',
        identity: matchIdentity(),
        soldItems: {
          status: 'REVIEW',
          inventoryConflict: false,
          segmentationConflict: false,
          message: 'Possible extra accessory — review against pack list',
          regions: [{ x: 0.72, y: 0.12, width: 0.2, height: 0.22 }],
        },
      };
    }
    if (scenario === 'UNSOLD_CONFLICT') {
      return {
        provider: this.name,
        modelId: 'fake-vision-qa-v1',
        identity: matchIdentity(),
        soldItems: {
          status: 'FAIL',
          inventoryConflict: true,
          segmentationConflict: true,
          message: 'Accessory conflicts with confirmed inventory and mask',
          regions: [{ x: 0.72, y: 0.12, width: 0.2, height: 0.22 }],
        },
      };
    }
    if (scenario === 'WATERMARK') {
      return {
        provider: this.name,
        modelId: 'fake-vision-qa-v1',
        identity: matchIdentity(),
        soldItems: {
          status: 'PASS',
          inventoryConflict: false,
          segmentationConflict: false,
          regions: [],
        },
        borderWatermark: {
          status: 'REVIEW',
          confidence: 0.7,
          regions: [{ x: 0.75, y: 0.75, width: 0.2, height: 0.15 }],
          message: 'Possible watermark',
        },
      };
    }
    return {
      provider: this.name,
      modelId: 'fake-vision-qa-v1',
      identity: matchIdentity(),
      soldItems: {
        status: 'PASS',
        inventoryConflict: false,
        segmentationConflict: false,
        regions: [],
      },
      borderWatermark: {
        status: 'PASS',
        confidence: 0.99,
        regions: [],
      },
    };
  }
}
