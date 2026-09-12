import { describe, expect, it } from 'vitest';
import {
  buildExportImagePath,
  buildQaReportCsv,
  csvRowsFromManifest,
  manifestSha256,
  sanitizeExportToken,
  type ExportManifestV1,
} from '../src/index.js';

describe('W6-07 export filename / CSV / checksum', () => {
  it('sanitizes NFKD + non-ascii to ASCII tokens', () => {
    expect(sanitizeExportToken('mug blk 450')).toBe('MUG_BLK_450');
    expect(sanitizeExportToken('café')).toBe('CAFE');
    expect(sanitizeExportToken('')).toBe('NA');
    expect(sanitizeExportToken(null)).toBe('NA');
  });

  it('builds image path and avoids collisions with short hash', () => {
    const used = new Set<string>();
    const a = buildExportImagePath({
      sku: 'SKU-SYN-001',
      marketplaceCode: 'US',
      slot: 'MAIN',
      variantCode: 'BASE',
      outputIndex: 1,
      versionNumber: 3,
      usedPaths: used,
    });
    expect(a).toBe('images/SKU-SYN-001_US_MAIN_BASE_01_v3.png');
    const b = buildExportImagePath({
      sku: 'SKU-SYN-001',
      marketplaceCode: 'US',
      slot: 'MAIN',
      variantCode: 'BASE',
      outputIndex: 1,
      versionNumber: 3,
      usedPaths: used,
    });
    expect(b).not.toBe(a);
    expect(b.startsWith('images/SKU-SYN-001_US_MAIN_BASE_01_v3_')).toBe(true);
  });

  it('CSV has BOM + fixed columns; OVERRIDE writes reason', () => {
    const manifest: ExportManifestV1 = {
      schemaVersion: 1,
      bundleId: '11111111-1111-7111-8111-111111111111',
      createdAt: '2026-09-12T00:00:00.000Z',
      workspaceId: 'w',
      projectId: 'p',
      sku: 'SKU-SYN-001',
      marketplaceCode: 'US',
      truthRevisionId: 't',
      rulePack: { key: 'amazon-main-us-v1', version: 1 },
      files: [
        {
          path: 'images/SKU-SYN-001_US_MAIN_BASE_01_v3.png',
          sha256: 'aa',
          bytes: 12,
          mime: 'image/png',
          slot: 'MAIN',
          variantCode: 'BASE',
          assetVersionId: 'av',
          qaReportId: 'qr',
          approval: {
            id: 'ap',
            decision: 'OVERRIDE_BLOCK',
            actorId: 'u',
            decidedAt: '2026-09-12T00:00:00.000Z',
            reason: 'ops accept halo',
          },
          workflowRevisionId: null,
          winningAttemptId: null,
        },
      ],
    };
    expect(manifestSha256(manifest)).toMatch(/^[0-9a-f]{64}$/);
    const rows = csvRowsFromManifest({
      manifest,
      qaStatusByReportId: { qr: 'BLOCK' },
      findingsByReportId: {
        qr: [
          {
            ruleId: 'MAIN.BACKGROUND_WHITE',
            status: 'FAIL',
            severity: 'HIGH',
            nonWaivable: false,
            message: 'not white',
          },
        ],
      },
    });
    const csv = buildQaReportCsv(rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('sku,marketplace_code,slot');
    expect(csv).toContain('OVERRIDE_BLOCK');
    expect(csv).toContain('ops accept halo');
    expect(csv).toContain('MAIN.BACKGROUND_WHITE');
  });
});
