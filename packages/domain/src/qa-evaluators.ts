/**
 * Pure rule evaluators. Pixel / OCR / Vision inputs are precomputed ports.
 * Thresholds come from MarketRule.params (spec §11.5).
 */

import type { MarketRule } from './qa-rule-pack.js';
import {
  fullFrameRegion,
  type EvidenceRegion,
  type QaFinding,
  type QaFindingStatus,
} from './qa-findings.js';

export type QaPixelMetrics = {
  decodable: boolean;
  mime: string;
  width: number;
  height: number;
  shortSide: number;
  backgroundWhiteRatio: number;
  subjectExtent: number;
  maskConfidence: number;
  minEdgeMarginRatio: number;
  touchesEdge: boolean;
  blurScore: number;
  hasBorder: boolean;
  subjectBBox: EvidenceRegion;
};

export type OcrToken = {
  text: string;
  confidence: number;
  region: EvidenceRegion;
  onProductPrint?: boolean;
};

export type OcrInspectSnapshot = {
  provider: string;
  modelId: string;
  tokens: OcrToken[];
};

export type VisionCheckStatus = 'MATCH' | 'REVIEW' | 'FAIL';

export type VisionQaSnapshot = {
  provider: string;
  modelId: string;
  identity: {
    geometry: VisionCheckStatus;
    logo: VisionCheckStatus;
    ports: VisionCheckStatus;
    controls: VisionCheckStatus;
    material: VisionCheckStatus;
    itemCount: VisionCheckStatus;
    overall: VisionCheckStatus;
    regions: EvidenceRegion[];
    message?: string;
  };
  soldItems: {
    status: QaFindingStatus;
    inventoryConflict: boolean;
    segmentationConflict: boolean;
    message?: string;
    regions: EvidenceRegion[];
  };
  borderWatermark?: {
    status: QaFindingStatus;
    confidence: number;
    regions: EvidenceRegion[];
    message?: string;
  };
};

export type ConfirmedFact = { key: string; value: unknown };

export type EvaluatorContext = {
  slot: string | null;
  candidateAssetVersionId: string;
  metrics: QaPixelMetrics;
  ocr: OcrInspectSnapshot;
  vision: VisionQaSnapshot;
  confirmedFacts: ConfirmedFact[];
};

const MAIN_ONLY = new Set([
  'MAIN.BACKGROUND_WHITE',
  'MAIN.SUBJECT_FRAME_EXTENT',
  'MAIN.NOT_CROPPED',
  'MAIN.NO_OVERLAY_TEXT',
  'MAIN.NO_BORDER_OR_WATERMARK',
  'MAIN.ONLY_SOLD_ITEMS',
]);

function finding(
  rule: MarketRule,
  status: QaFindingStatus,
  message: string,
  ctx: EvaluatorContext,
  extras?: Partial<QaFinding>,
): QaFinding {
  return {
    ruleId: rule.ruleId,
    ruleVersion: 1,
    evaluator: rule.evaluator,
    status,
    severity: rule.severity,
    nonWaivable: rule.nonWaivable,
    message,
    evidence: {
      candidateAssetVersionId: ctx.candidateAssetVersionId,
      regions: extras?.evidence?.regions ?? [fullFrameRegion()],
      ocrExpected: extras?.evidence?.ocrExpected,
      ocrObserved: extras?.evidence?.ocrObserved,
      metrics: extras?.evidence?.metrics,
    },
    suggestedAction: extras?.suggestedAction ?? null,
    score: extras?.score ?? null,
  };
}

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function skipNonMain(rule: MarketRule, ctx: EvaluatorContext): QaFinding | null {
  if (!MAIN_ONLY.has(rule.ruleId)) return null;
  if ((ctx.slot ?? 'MAIN') === 'MAIN') return null;
  return finding(rule, 'PASS', `${rule.ruleId} applies to MAIN slot only`, ctx, {
    score: 1,
  });
}

function evalDecodable(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const allowed = Array.isArray(rule.params.allowedMime)
    ? (rule.params.allowedMime as string[])
    : ['image/png', 'image/jpeg'];
  if (ctx.metrics.decodable && allowed.includes(ctx.metrics.mime)) {
    return finding(rule, 'PASS', `Decodable ${ctx.metrics.mime}`, ctx, {
      score: 1,
      evidence: {
        candidateAssetVersionId: ctx.candidateAssetVersionId,
        regions: [fullFrameRegion()],
        metrics: { mime: ctx.metrics.mime, width: ctx.metrics.width, height: ctx.metrics.height },
      },
    });
  }
  return finding(rule, 'FAIL', `Not decodable or MIME ${ctx.metrics.mime} not allowed`, ctx, {
    score: 0,
    suggestedAction: 'Re-export as PNG or JPEG and re-upload',
  });
}

function evalMinShortSide(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const failBelow = num(rule.params, 'failBelow', 1000);
  const reviewBelow = num(rule.params, 'reviewBelow', 2000);
  const side = ctx.metrics.shortSide;
  const metrics = { shortSide: side, failBelow, reviewBelow };
  if (side < failBelow) {
    return finding(rule, 'FAIL', `Short side ${side}px < ${failBelow}px quality gate`, ctx, {
      score: side / failBelow,
      suggestedAction: 'Upscale or regenerate at ≥2000px short side',
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [fullFrameRegion()], metrics },
    });
  }
  if (side < reviewBelow) {
    return finding(rule, 'REVIEW', `Short side ${side}px is below ${reviewBelow}px preferred`, ctx, {
      score: side / reviewBelow,
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [fullFrameRegion()], metrics },
    });
  }
  return finding(rule, 'PASS', `Short side ${side}px meets ${reviewBelow}px`, ctx, {
    score: 1,
    evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [fullFrameRegion()], metrics },
  });
}

function evalBackgroundWhite(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const skip = skipNonMain(rule, ctx);
  if (skip) return skip;
  const passRatio = num(rule.params, 'passRatio', 0.995);
  const reviewRatio = num(rule.params, 'reviewRatio', 0.98);
  const ratio = ctx.metrics.backgroundWhiteRatio;
  const metrics = { backgroundWhiteRatio: ratio, passRatio, reviewRatio };
  if (ratio < reviewRatio) {
    return finding(rule, 'FAIL', `Background white ratio ${ratio.toFixed(4)} < ${reviewRatio}`, ctx, {
      score: ratio,
      suggestedAction: 'Replace background with pure white or pick another candidate',
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [fullFrameRegion()], metrics },
    });
  }
  if (ratio < passRatio) {
    return finding(rule, 'REVIEW', `Background white ratio ${ratio.toFixed(4)} in review band`, ctx, {
      score: ratio,
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [fullFrameRegion()], metrics },
    });
  }
  return finding(rule, 'PASS', `Background white ratio ${ratio.toFixed(4)}`, ctx, {
    score: ratio,
    evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [fullFrameRegion()], metrics },
  });
}

function evalSubjectExtent(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const skip = skipNonMain(rule, ctx);
  if (skip) return skip;
  const required = num(rule.params, 'requiredExtent', 0.85);
  const hardConf = num(rule.params, 'hardDecisionMaskConfidence', 0.9);
  const { subjectExtent: extent, maskConfidence, subjectBBox } = ctx.metrics;
  const metrics = { subjectExtent: extent, maskConfidence, required };
  if (maskConfidence < hardConf) {
    return finding(rule, 'REVIEW', `Subject mask confidence ${maskConfidence.toFixed(2)} < ${hardConf}`, ctx, {
      score: maskConfidence,
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [subjectBBox], metrics },
    });
  }
  if (extent < required) {
    return finding(rule, 'FAIL', `Subject frame extent ${extent.toFixed(3)} < ${required}`, ctx, {
      score: extent,
      suggestedAction: 'Reframe so the product fills ≥85% of the long canvas side',
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [subjectBBox], metrics },
    });
  }
  return finding(rule, 'PASS', `Subject frame extent ${extent.toFixed(3)}`, ctx, {
    score: extent,
    evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [subjectBBox], metrics },
  });
}

function evalEdgeMargin(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const skip = skipNonMain(rule, ctx);
  if (skip) return skip;
  const minMargin = num(rule.params, 'minimumEdgeMarginRatio', 0.01);
  const hardConf = num(rule.params, 'hardDecisionMaskConfidence', 0.9);
  const { minEdgeMarginRatio, touchesEdge, maskConfidence, subjectBBox } = ctx.metrics;
  const metrics = { minEdgeMarginRatio, touchesEdge, maskConfidence };
  if (maskConfidence < hardConf) {
    return finding(rule, 'REVIEW', 'Low mask confidence — suspected crop needs human review', ctx, {
      score: maskConfidence,
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [subjectBBox], metrics },
    });
  }
  if (touchesEdge || minEdgeMarginRatio < minMargin) {
    return finding(rule, 'FAIL', `Subject cropped or margin ${minEdgeMarginRatio.toFixed(4)} < ${minMargin}`, ctx, {
      score: minEdgeMarginRatio,
      suggestedAction: 'Add canvas margin or outpaint so the product is not clipped',
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [subjectBBox], metrics },
    });
  }
  return finding(rule, 'PASS', `Edge margin ${minEdgeMarginRatio.toFixed(4)}`, ctx, {
    score: 1,
    evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [subjectBBox], metrics },
  });
}

function normalizeFactText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && value && 'value' in value) {
    const rec = value as { value?: unknown; unit?: unknown };
    return `${rec.value ?? ''}${rec.unit ?? ''}`.toLowerCase();
  }
  return JSON.stringify(value).toLowerCase();
}

function evalOverlayText(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const skip = skipNonMain(rule, ctx);
  if (skip) return skip;
  const failConf = num(rule.params, 'failConfidence', 0.9);
  const allowPrint = rule.params.allowConfirmedProductPrint !== false;
  const unauthorized = ctx.ocr.tokens.filter((t) => {
    if (allowPrint && t.onProductPrint) return false;
    return t.text.trim().length > 0;
  });
  if (unauthorized.length === 0) {
    return finding(rule, 'PASS', 'No overlay text detected', ctx, { score: 1 });
  }
  const hard = unauthorized.filter((t) => t.confidence >= failConf);
  const regions = unauthorized.map((t) => t.region);
  const observed = unauthorized.map((t) => t.text).join(' | ');
  if (hard.length > 0) {
    return finding(rule, 'FAIL', `Overlay text outside product print: ${observed}`, ctx, {
      score: 1 - hard[0]!.confidence,
      suggestedAction: 'Remove badges/promos or inpaint overlay text',
      evidence: {
        candidateAssetVersionId: ctx.candidateAssetVersionId,
        regions,
        ocrObserved: observed,
        metrics: { failConfidence: failConf },
      },
    });
  }
  return finding(rule, 'REVIEW', `Low-confidence overlay text: ${observed}`, ctx, {
    score: unauthorized[0]?.confidence ?? 0.5,
    evidence: {
      candidateAssetVersionId: ctx.candidateAssetVersionId,
      regions,
      ocrObserved: observed,
    },
  });
}

function evalBorder(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const skip = skipNonMain(rule, ctx);
  if (skip) return skip;
  const reviewBelow = num(rule.params, 'visionReviewBelowConfidence', 0.9);
  if (ctx.metrics.hasBorder) {
    return finding(rule, 'FAIL', 'Border or frame detected on canvas edges', ctx, {
      score: 0,
      suggestedAction: 'Crop the decorative border or regenerate without frames',
    });
  }
  const vis = ctx.vision.borderWatermark;
  if (vis?.status === 'FAIL') {
    return finding(rule, 'FAIL', vis.message ?? 'Vision detected border/watermark', ctx, {
      score: vis.confidence,
      evidence: {
        candidateAssetVersionId: ctx.candidateAssetVersionId,
        regions: vis.regions.length ? vis.regions : [fullFrameRegion()],
      },
    });
  }
  if (vis?.status === 'REVIEW' || (vis && vis.confidence < reviewBelow && vis.status !== 'PASS')) {
    return finding(rule, 'REVIEW', vis.message ?? 'Possible watermark — review', ctx, {
      score: vis.confidence,
      evidence: {
        candidateAssetVersionId: ctx.candidateAssetVersionId,
        regions: vis.regions.length ? vis.regions : [fullFrameRegion()],
      },
    });
  }
  return finding(rule, 'PASS', 'No border or watermark', ctx, { score: 1 });
}

function evalSoldItems(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const skip = skipNonMain(rule, ctx);
  if (skip) return skip;
  const sold = ctx.vision.soldItems;
  const dual =
    rule.params.failRequiresInventoryAndSegmentationConflict === true &&
    sold.inventoryConflict &&
    sold.segmentationConflict;
  if (dual || sold.status === 'FAIL') {
    return finding(rule, 'FAIL', sold.message ?? 'Unsold accessory conflicts with inventory + mask', ctx, {
      score: 0,
      suggestedAction: 'Remove accessories that are not in the confirmed pack list',
      evidence: {
        candidateAssetVersionId: ctx.candidateAssetVersionId,
        regions: sold.regions.length ? sold.regions : [fullFrameRegion()],
        metrics: { inventoryConflict: sold.inventoryConflict, segmentationConflict: sold.segmentationConflict },
      },
    });
  }
  if (sold.status === 'REVIEW' || rule.params.reviewByDefault === true && sold.status !== 'PASS') {
    return finding(rule, 'REVIEW', sold.message ?? 'Possible unsold accessory — review', ctx, {
      score: 0.5,
      evidence: {
        candidateAssetVersionId: ctx.candidateAssetVersionId,
        regions: sold.regions.length ? sold.regions : [fullFrameRegion()],
      },
    });
  }
  return finding(rule, 'PASS', sold.message ?? 'Only sold items visible', ctx, {
    score: 1,
    evidence: {
      candidateAssetVersionId: ctx.candidateAssetVersionId,
      regions: sold.regions.length ? sold.regions : [fullFrameRegion()],
    },
  });
}

function evalIdentity(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const id = ctx.vision.identity;
  const checks = Array.isArray(rule.params.check) ? (rule.params.check as string[]) : [];
  const failed = checks.filter((k) => {
    const v = id[k as keyof typeof id];
    return v === 'FAIL';
  });
  const reviewed = checks.filter((k) => id[k as keyof typeof id] === 'REVIEW');
  const regions = id.regions.length ? id.regions : [ctx.metrics.subjectBBox];
  if (id.overall === 'FAIL' || failed.length > 0) {
    return finding(rule, 'FAIL', id.message ?? `Identity mismatch: ${failed.join(', ') || 'overall'}`, ctx, {
      score: 0,
      suggestedAction: 'Regenerate with product-lock or pick a closer candidate',
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions },
    });
  }
  if (id.overall === 'REVIEW' || reviewed.length > 0) {
    return finding(rule, 'REVIEW', id.message ?? `Identity needs review: ${reviewed.join(', ') || 'overall'}`, ctx, {
      score: 0.6,
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions },
    });
  }
  return finding(rule, 'PASS', id.message ?? 'Product identity matches confirmed truth', ctx, {
    score: 1,
    evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions },
  });
}

function evalBlur(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const failBelow = num(rule.params, 'failBelow', 40);
  const reviewBelow = num(rule.params, 'reviewBelow', 90);
  const score = ctx.metrics.blurScore;
  const metrics = { blurScore: score, failBelow, reviewBelow, profile: rule.params.thresholdProfile };
  if (score < failBelow) {
    return finding(rule, 'FAIL', `Blur score ${score.toFixed(1)} < ${failBelow}`, ctx, {
      score: score / failBelow,
      suggestedAction: 'Use a sharper source or upscale with a detail-preserving engine',
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [fullFrameRegion()], metrics },
    });
  }
  if (score < reviewBelow) {
    return finding(rule, 'REVIEW', `Blur score ${score.toFixed(1)} in review band`, ctx, {
      score: score / reviewBelow,
      evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [fullFrameRegion()], metrics },
    });
  }
  return finding(rule, 'PASS', `Blur score ${score.toFixed(1)}`, ctx, {
    score: 1,
    evidence: { candidateAssetVersionId: ctx.candidateAssetVersionId, regions: [fullFrameRegion()], metrics },
  });
}

function evalFactMatch(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const keys = Array.isArray(rule.params.keys)
    ? (rule.params.keys as string[])
    : ['brand', 'model', 'sku'];
  const failConf = num(rule.params, 'failConfidence', 0.9);
  const facts = ctx.confirmedFacts.filter((f) => keys.includes(f.key));
  if (facts.length === 0) {
    return finding(rule, 'PASS', 'No confirmed text/number facts to check', ctx, { score: 1 });
  }
  const observed = ctx.ocr.tokens.map((t) => t.text);
  const observedNorm = observed.map((t) => t.toLowerCase());
  const mismatches: Array<{ key: string; expected: string; token?: OcrToken }> = [];
  for (const fact of facts) {
    const expected = normalizeFactText(fact.value);
    if (!expected) continue;
    const hit = ctx.ocr.tokens.find((t) => {
      const tn = t.text.toLowerCase();
      return tn.includes(expected) || expected.includes(tn);
    });
    // Only flag when OCR claims a conflicting value for the same key-like token.
    const conflict = ctx.ocr.tokens.find((t) => {
      if (t.confidence < failConf) return false;
      const tn = t.text.toLowerCase();
      if (!tn) return false;
      if (tn.includes(expected) || expected.includes(tn)) return false;
      // Heuristic: same-key conflict when token is tagged via "key:value" or brand-like allcaps.
      return t.text.includes(':') && t.text.toLowerCase().startsWith(`${fact.key.toLowerCase()}:`);
    });
    if (conflict) mismatches.push({ key: fact.key, expected, token: conflict });
    void hit;
    void observedNorm;
  }
  if (mismatches.length === 0) {
    return finding(rule, 'PASS', 'OCR matches confirmed truth facts (or no conflicting tokens)', ctx, {
      score: 1,
      evidence: {
        candidateAssetVersionId: ctx.candidateAssetVersionId,
        regions: [fullFrameRegion()],
        ocrExpected: facts.map((f) => `${f.key}=${normalizeFactText(f.value)}`).join(','),
        ocrObserved: observed.join(' | ') || null,
      },
    });
  }
  const first = mismatches[0]!;
  return finding(
    rule,
    'FAIL',
    `OCR "${first.token?.text ?? ''}" conflicts with confirmed ${first.key}="${first.expected}"`,
    ctx,
    {
      score: 0,
      suggestedAction: 'Fix spelling or regenerate text from confirmed facts only',
      evidence: {
        candidateAssetVersionId: ctx.candidateAssetVersionId,
        regions: first.token ? [first.token.region] : [fullFrameRegion()],
        ocrExpected: first.expected,
        ocrObserved: first.token?.text ?? null,
      },
    },
  );
}

const EVALUATORS: Record<string, (rule: MarketRule, ctx: EvaluatorContext) => QaFinding> = {
  'file.decodable.v1': evalDecodable,
  'image.minShortSide.v1': evalMinShortSide,
  'amazon.backgroundWhite.v1': evalBackgroundWhite,
  'amazon.subjectExtent.v1': evalSubjectExtent,
  'amazon.edgeMargin.v1': evalEdgeMargin,
  'amazon.overlayText.v1': evalOverlayText,
  'amazon.borderWatermark.v1': evalBorder,
  'amazon.soldItems.v1': evalSoldItems,
  'product.identity.v1': evalIdentity,
  'image.blur.v1': evalBlur,
  'ocr.factMatch.v1': evalFactMatch,
};

export function evaluateRule(rule: MarketRule, ctx: EvaluatorContext): QaFinding {
  const fn = EVALUATORS[rule.evaluator];
  if (!fn) {
    return finding(rule, 'REVIEW', `Unknown evaluator ${rule.evaluator}`, ctx, { score: 0 });
  }
  return fn(rule, ctx);
}

export function evaluateRulePack(rules: MarketRule[], ctx: EvaluatorContext): QaFinding[] {
  return rules.map((rule) => evaluateRule(rule, ctx));
}
