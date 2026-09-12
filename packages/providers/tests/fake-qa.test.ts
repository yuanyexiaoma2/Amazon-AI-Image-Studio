import { describe, expect, it } from 'vitest';
import { FakeOcrProvider, FakeVisionQaProvider } from '../src/index.js';

describe('Fake OCR / Vision QA', () => {
  it('SUCCESS OCR keeps brand on product print', async () => {
    const ocr = new FakeOcrProvider();
    const r = await ocr.inspect({
      assetVersionId: 'av',
      scenario: 'SUCCESS',
      confirmedFacts: [{ key: 'brand', value: 'Acme' }],
    });
    expect(r.provider).toBe('fake-ocr');
    expect(r.tokens[0]?.onProductPrint).toBe(true);
  });

  it('OVERLAY_TEXT and FACT_MISMATCH scenarios', async () => {
    const ocr = new FakeOcrProvider();
    const over = await ocr.inspect({ assetVersionId: 'av', scenario: 'OVERLAY_TEXT' });
    expect(over.tokens[0]?.text).toMatch(/SALE/);
    expect(over.tokens[0]?.onProductPrint).toBe(false);
    const mm = await ocr.inspect({ assetVersionId: 'av', scenario: 'FACT_MISMATCH' });
    expect(mm.tokens[0]?.text).toContain('ACOME');
  });

  it('vision identity / unsold scenarios', async () => {
    const vis = new FakeVisionQaProvider();
    const ok = await vis.inspectProduct({ assetVersionId: 'av', scenario: 'SUCCESS' });
    expect(ok.identity.overall).toBe('MATCH');
    const bad = await vis.inspectProduct({ assetVersionId: 'av', scenario: 'IDENTITY_MISMATCH' });
    expect(bad.identity.overall).toBe('FAIL');
    const sold = await vis.inspectProduct({ assetVersionId: 'av', scenario: 'UNSOLD_CONFLICT' });
    expect(sold.soldItems.inventoryConflict).toBe(true);
    expect(sold.soldItems.segmentationConflict).toBe(true);
  });
});
