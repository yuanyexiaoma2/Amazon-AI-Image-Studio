/**
 * Build Export v1 ZIP (manifest + CSV + images) with fixed timestamps (spec §32.11).
 */

import type { PrismaClient } from '@studio/db';
import { AssetRepository, ExportRepository } from '@studio/db';
import type { ObjectStorage } from '@studio/storage';
import {
  buildQaReportCsv,
  csvRowsFromManifest,
  manifestSha256,
  type ExportManifestV1,
} from '@studio/domain';
import { sha256Hex } from './hash.js';
import { buildStoredZip } from './zip-store.js';

export async function runExportBundle(deps: {
  db: PrismaClient;
  storage: ObjectStorage;
  workspaceId: string;
  bundleId: string;
}): Promise<void> {
  const exports = new ExportRepository(deps.db);
  const assets = new AssetRepository(deps.db);
  const bundle = await exports.getBundle(deps.workspaceId, deps.bundleId);
  if (!bundle) throw new Error(`Export bundle ${deps.bundleId} not found`);

  await exports.markRunning(deps.workspaceId, deps.bundleId);

  try {
    const createdAt = bundle.createdAt;
    const files: ExportManifestV1['files'] = [];
    const zipEntries: Array<{ path: string; bytes: Buffer }> = [];
    const findingsByReportId: Record<
      string,
      Array<{ ruleId: string; status: string; severity: string; nonWaivable: boolean; message: string }>
    > = {};
    const qaStatusByReportId: Record<string, string> = {};

    for (const item of bundle.items) {
      const version = await assets.getVersionWithRepresentations(deps.workspaceId, item.assetVersionId);
      if (!version) throw new Error(`Asset version ${item.assetVersionId} missing`);
      const rep =
        version.representations.find((r) => r.kind === 'NORMALIZED_PNG') ??
        version.representations.find((r) => r.kind === 'ORIGINAL_UPLOAD') ??
        version.representations[0];
      if (!rep) throw new Error(`No representation for ${item.assetVersionId}`);
      const obj = await deps.storage.getObject(rep.storageKey);
      const sha = sha256Hex(obj.body);
      zipEntries.push({ path: item.path, bytes: obj.body });

      const approval = await deps.db.approval.findFirst({
        where: { id: item.approvalId, workspaceId: deps.workspaceId },
      });
      if (!approval) throw new Error(`Approval ${item.approvalId} missing`);

      const report = await deps.db.qaReport.findFirst({
        where: { id: item.qaReportId, workspaceId: deps.workspaceId },
        include: { findings: { orderBy: { ruleId: 'asc' } } },
      });
      if (!report) throw new Error(`QA report ${item.qaReportId} missing`);
      qaStatusByReportId[report.id] = report.overallStatus ?? '';
      findingsByReportId[report.id] = report.findings.map((f) => ({
        ruleId: f.ruleId,
        status: f.status,
        severity: f.severity,
        nonWaivable: f.nonWaivable,
        message: f.message,
      }));

      files.push({
        path: item.path,
        sha256: sha,
        bytes: obj.body.length,
        mime: item.mime,
        slot: item.slot,
        variantCode: item.variantCode,
        assetVersionId: item.assetVersionId,
        qaReportId: item.qaReportId,
        approval: {
          id: approval.id,
          decision: approval.decision,
          actorId: approval.actorUserId,
          decidedAt: approval.decidedAt.toISOString(),
          reason: approval.reason,
        },
        workflowRevisionId: approval.workflowRevisionId,
        winningAttemptId: null,
      });
    }

    const manifest: ExportManifestV1 = {
      schemaVersion: 1,
      bundleId: bundle.id,
      createdAt: createdAt.toISOString(),
      workspaceId: bundle.workspaceId,
      projectId: bundle.projectId,
      sku: bundle.sku,
      marketplaceCode: bundle.marketplaceCode,
      truthRevisionId: bundle.truthRevisionId,
      rulePack: { key: bundle.rulePackKey, version: bundle.rulePackVersion },
      files,
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const csv = buildQaReportCsv(csvRowsFromManifest({ manifest, findingsByReportId, qaStatusByReportId }));

    zipEntries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const ordered = [
      { path: 'manifest.json', bytes: Buffer.from(manifestText, 'utf8') },
      { path: 'qa-report.csv', bytes: Buffer.from(csv, 'utf8') },
      ...zipEntries,
    ];
    const zip = buildStoredZip(ordered, createdAt);
    const zipSha = sha256Hex(zip);
    const key = `workspaces/${bundle.workspaceId}/projects/${bundle.projectId}/exports/${bundle.id}/bundle.zip`;
    await deps.storage.putObject({ key, body: zip, contentType: 'application/zip' });

    await exports.markSucceeded({
      workspaceId: deps.workspaceId,
      bundleId: deps.bundleId,
      manifestJson: manifest,
      manifestSha256: manifestSha256(manifest),
      zipStorageKey: key,
      zipSha256: zipSha,
      zipBytes: zip.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await exports.markFailed(deps.workspaceId, deps.bundleId, msg);
    throw err;
  }
}
