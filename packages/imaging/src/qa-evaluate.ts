/**
 * QA evaluation orchestration (W6-02…05). Pixel metrics + injected Fake OCR/Vision.
 */

import type { PrismaClient } from '@studio/db';
import { AssetRepository, QaRepository } from '@studio/db';
import type { ObjectStorage } from '@studio/storage';
import {
  aggregateQaReport,
  evaluateRulePack,
  qaInputFingerprint,
  type ConfirmedFact,
  type MarketRule,
  type MarketRulePack,
  type OcrInspectSnapshot,
  type VisionQaSnapshot,
} from '@studio/domain';
import { analyzeQaPixels } from './qa-metrics.js';

export type QaOcrPort = {
  inspect(req: {
    assetVersionId: string;
    scenario?: string;
    confirmedFacts?: ConfirmedFact[];
  }): Promise<OcrInspectSnapshot>;
};

export type QaVisionPort = {
  inspectProduct(req: { assetVersionId: string; scenario?: string }): Promise<VisionQaSnapshot>;
};

export async function runQaEvaluation(deps: {
  db: PrismaClient;
  storage: ObjectStorage;
  workspaceId: string;
  reportId: string;
  ocr: QaOcrPort;
  vision: QaVisionPort;
}): Promise<void> {
  const qa = new QaRepository(deps.db);
  const assets = new AssetRepository(deps.db);
  const report = await qa.getReport(deps.workspaceId, deps.reportId);
  if (!report) throw new Error(`QA report ${deps.reportId} not found`);

  await qa.markRunning(deps.workspaceId, deps.reportId);

  try {
    const version = await assets.getVersionWithRepresentations(deps.workspaceId, report.assetVersionId);
    if (!version) throw new Error('Asset version not found');
    const rep =
      version.representations.find((r) => r.kind === 'NORMALIZED_PNG') ??
      version.representations.find((r) => r.kind === 'ORIGINAL_UPLOAD') ??
      version.representations[0];
    if (!rep) throw new Error('No image representation for QA');

    const obj = await deps.storage.getObject(rep.storageKey);
    const metrics = await analyzeQaPixels({ bytes: obj.body });

    const pack = report.rulePackSnapshotJson as unknown as MarketRulePack;
    const rules = (pack.rules ?? []) as MarketRule[];

    let confirmedFacts: ConfirmedFact[] = [];
    if (report.truthRevisionId) {
      const facts = await deps.db.productFact.findMany({
        where: {
          workspaceId: deps.workspaceId,
          truthRevisionId: report.truthRevisionId,
          status: { in: ['CONFIRMED', 'LOCKED'] },
        },
      });
      confirmedFacts = facts.map((f) => ({ key: f.key, value: f.valueJson }));
    }

    const ocr = await deps.ocr.inspect({
      assetVersionId: report.assetVersionId,
      scenario: report.ocrScenario ?? 'SUCCESS',
      confirmedFacts,
    });
    const vision = await deps.vision.inspectProduct({
      assetVersionId: report.assetVersionId,
      scenario: report.visionScenario ?? 'SUCCESS',
    });

    const findings = evaluateRulePack(rules, {
      slot: report.slot,
      candidateAssetVersionId: report.assetVersionId,
      metrics,
      ocr,
      vision,
      confirmedFacts,
    });
    const overall = aggregateQaReport(findings);
    const fingerprint = qaInputFingerprint({
      assetVersionId: report.assetVersionId,
      assetSha256: version.sha256,
      rulePackKey: report.rulePackKey,
      rulePackVersion: report.rulePackVersion,
      rulePackSha256: report.rulePackSha256,
      truthRevisionId: report.truthRevisionId,
      shotBriefRevisionId: report.shotBriefId,
      slot: report.slot,
      ocrModelId: ocr.modelId,
      visionModelId: vision.modelId,
    });

    await qa.persistFindings({
      workspaceId: deps.workspaceId,
      reportId: deps.reportId,
      overallStatus: overall,
      findings,
      inputFingerprint: fingerprint,
      ocrSnapshot: ocr,
      visionSnapshot: vision,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await qa.markFailed(deps.workspaceId, deps.reportId, msg);
    throw err;
  }
}
