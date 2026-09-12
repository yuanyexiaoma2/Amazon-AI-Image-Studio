import { describe, expect, it } from 'vitest';
import {
  AMAZON_MAIN_US_V1,
  aggregateQaReport,
  evaluateRulePack,
  fullFrameRegion,
  type EvaluatorContext,
} from '../src/index.js';

function ctx(over: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    slot: 'MAIN',
    candidateAssetVersionId: 'av1',
    metrics: {
      decodable: true,
      mime: 'image/png',
      width: 2000,
      height: 2000,
      shortSide: 2000,
      backgroundWhiteRatio: 0.997,
      subjectExtent: 0.9,
      maskConfidence: 0.95,
      minEdgeMarginRatio: 0.04,
      touchesEdge: false,
      blurScore: 180,
      hasBorder: false,
      subjectBBox: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
    },
    ocr: { provider: 'fake-ocr', modelId: 'fake-ocr-v1', tokens: [] },
    vision: {
      provider: 'fake-vision',
      modelId: 'fake-vision-qa-v1',
      identity: {
        geometry: 'MATCH',
        logo: 'MATCH',
        ports: 'MATCH',
        controls: 'MATCH',
        material: 'MATCH',
        itemCount: 'MATCH',
        overall: 'MATCH',
        regions: [fullFrameRegion()],
      },
      soldItems: {
        status: 'PASS',
        inventoryConflict: false,
        segmentationConflict: false,
        regions: [],
      },
    },
    confirmedFacts: [{ key: 'brand', value: 'Acme' }],
    ...over,
  };
}

describe('W6-02/03/04 evaluators', () => {
  it('PASS fixture yields overall PASS', () => {
    const findings = evaluateRulePack(AMAZON_MAIN_US_V1.rules, ctx());
    expect(findings.every((f) => f.status === 'PASS')).toBe(true);
    expect(aggregateQaReport(findings)).toBe('PASS');
  });

  it('short side <1000 FAIL HIGH → BLOCK; 1000-1999 REVIEW', () => {
    const fail = evaluateRulePack(AMAZON_MAIN_US_V1.rules, ctx({
      metrics: { ...ctx().metrics, shortSide: 800, width: 800, height: 800 },
    }));
    expect(fail.find((f) => f.ruleId === 'FILE.MIN_SHORT_SIDE')?.status).toBe('FAIL');
    expect(aggregateQaReport(fail)).toBe('BLOCK');

    const review = evaluateRulePack(AMAZON_MAIN_US_V1.rules, ctx({
      metrics: { ...ctx().metrics, shortSide: 1500, width: 1500, height: 1500 },
    }));
    expect(review.find((f) => f.ruleId === 'FILE.MIN_SHORT_SIDE')?.status).toBe('REVIEW');
  });

  it('non-white background FAIL → BLOCK', () => {
    const findings = evaluateRulePack(AMAZON_MAIN_US_V1.rules, ctx({
      metrics: { ...ctx().metrics, backgroundWhiteRatio: 0.7 },
    }));
    expect(findings.find((f) => f.ruleId === 'MAIN.BACKGROUND_WHITE')?.status).toBe('FAIL');
    expect(aggregateQaReport(findings)).toBe('BLOCK');
  });

  it('OCR overlay high-confidence FAIL; fact mismatch FAIL', () => {
    const overlay = evaluateRulePack(
      AMAZON_MAIN_US_V1.rules,
      ctx({
        ocr: {
          provider: 'fake-ocr',
          modelId: 'fake-ocr-v1',
          tokens: [
            {
              text: 'SALE 50%',
              confidence: 0.95,
              region: { x: 0.1, y: 0.1, width: 0.2, height: 0.08 },
              onProductPrint: false,
            },
          ],
        },
      }),
    );
    const o = overlay.find((f) => f.ruleId === 'MAIN.NO_OVERLAY_TEXT');
    expect(o?.status).toBe('FAIL');
    expect(o?.evidence.regions[0]?.x).toBeCloseTo(0.1);

    const mismatch = evaluateRulePack(
      AMAZON_MAIN_US_V1.rules,
      ctx({
        ocr: {
          provider: 'fake-ocr',
          modelId: 'fake-ocr-v1',
          tokens: [
            {
              text: 'brand:ACOME',
              confidence: 0.96,
              region: { x: 0.3, y: 0.4, width: 0.2, height: 0.08 },
            },
          ],
        },
      }),
    );
    expect(mismatch.find((f) => f.ruleId === 'PRODUCT.FACT_TEXT_MATCH')?.status).toBe('FAIL');
  });

  it('vision identity FAIL and unsold dual-conflict FAIL', () => {
    const id = evaluateRulePack(
      AMAZON_MAIN_US_V1.rules,
      ctx({
        vision: {
          ...ctx().vision,
          identity: { ...ctx().vision.identity, logo: 'FAIL', overall: 'FAIL', message: 'logo drift' },
        },
      }),
    );
    expect(id.find((f) => f.ruleId === 'PRODUCT.IDENTITY')?.status).toBe('FAIL');

    const sold = evaluateRulePack(
      AMAZON_MAIN_US_V1.rules,
      ctx({
        vision: {
          ...ctx().vision,
          soldItems: {
            status: 'FAIL',
            inventoryConflict: true,
            segmentationConflict: true,
            message: 'extra lid',
            regions: [{ x: 0.7, y: 0.1, width: 0.2, height: 0.2 }],
          },
        },
      }),
    );
    expect(sold.find((f) => f.ruleId === 'MAIN.ONLY_SOLD_ITEMS')?.status).toBe('FAIL');
  });

  it('MAIN rules skip on FEATURE slot', () => {
    const findings = evaluateRulePack(AMAZON_MAIN_US_V1.rules, ctx({ slot: 'FEATURE' }));
    expect(findings.find((f) => f.ruleId === 'MAIN.BACKGROUND_WHITE')?.message).toMatch(/MAIN slot only/);
    expect(findings.find((f) => f.ruleId === 'MAIN.BACKGROUND_WHITE')?.status).toBe('PASS');
  });
});
