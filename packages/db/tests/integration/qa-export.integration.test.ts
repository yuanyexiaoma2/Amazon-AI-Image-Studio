import { afterAll, describe, expect, it } from 'vitest';
import {
  computeEffectiveApproval,
  assertExportAllowed,
  type QaFinding,
} from '@studio/domain';
import { PrismaClient } from '@prisma/client';
import { QaRepository, newId } from '../../src/index.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('W6 QA / approval persistence', () => {
  const db = new PrismaClient();
  const qa = new QaRepository(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  async function seed() {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const userId = newId();
    const workspaceId = newId();
    const projectId = newId();
    const assetId = newId();
    const versionId = newId();
    await db.user.create({
      data: { id: userId, email: `w6-${suffix}@example.com`, passwordHash: 'x' },
    });
    await db.workspace.create({ data: { id: workspaceId, name: 'W6', ownerUserId: userId } });
    await db.project.create({
      data: { id: projectId, workspaceId, sku: `W6-${suffix}`, name: 'QA' },
    });
    await db.asset.create({
      data: {
        id: assetId,
        workspaceId,
        projectId,
        kind: 'PRODUCT_PHOTO',
        status: 'READY',
        createdByUserId: userId,
      },
    });
    await db.assetVersion.create({
      data: {
        id: versionId,
        workspaceId,
        assetId,
        versionNumber: 1,
        sha256: 'a'.repeat(64),
        mime: 'image/png',
        width: 2000,
        height: 2000,
        byteSize: 12,
      },
    });
    const truthDocId = newId();
    const truthRevId = newId();
    await db.productTruthDocument.create({
      data: { id: truthDocId, workspaceId, projectId },
    });
    await db.productTruthRevision.create({
      data: {
        id: truthRevId,
        workspaceId,
        documentId: truthDocId,
        revision: 1,
        status: 'APPROVED',
        createdByUserId: userId,
      },
    });
    await db.productTruthDocument.update({
      where: { id: truthDocId },
      data: { approvedRevisionId: truthRevId, currentRevisionId: truthRevId },
    });
    return { userId, workspaceId, projectId, versionId, truthRevId };
  }

  it('persists findings + effective approval; tenant isolation', async () => {
    const a = await seed();
    const report = await qa.createQueuedReport({
      workspaceId: a.workspaceId,
      projectId: a.projectId,
      assetVersionId: a.versionId,
      createdByUserId: a.userId,
      slot: 'MAIN',
      truthRevisionId: a.truthRevId,
    });
    expect(report.rulePackKey).toBe('amazon-main-us-v1');
    expect(report.rulePackSha256).toMatch(/^[0-9a-f]{64}$/);

    const finding: QaFinding = {
      ruleId: 'FILE.DECODABLE',
      ruleVersion: 1,
      evaluator: 'file.decodable.v1',
      status: 'PASS',
      severity: 'CRITICAL',
      nonWaivable: true,
      message: 'ok',
      evidence: { candidateAssetVersionId: a.versionId, regions: [] },
    };
    await qa.persistFindings({
      workspaceId: a.workspaceId,
      reportId: report.id,
      overallStatus: 'PASS',
      findings: [finding],
      inputFingerprint: 'fp1',
      ocrSnapshot: { provider: 'fake-ocr', modelId: 'fake-ocr-v1', tokens: [] },
      visionSnapshot: { provider: 'fake-vision-qa', modelId: 'fake-vision-qa-v1' },
    });
    const loaded = await qa.getReport(a.workspaceId, report.id);
    expect(loaded?.status).toBe('SUCCEEDED');
    expect(loaded?.findings).toHaveLength(1);

    const otherWs = newId();
    const ghost = await qa.getReport(otherWs, report.id);
    expect(ghost).toBeNull();

    await qa.appendApproval({
      workspaceId: a.workspaceId,
      projectId: a.projectId,
      assetVersionId: a.versionId,
      qaReportId: report.id,
      truthRevisionId: a.truthRevId,
      decision: 'APPROVE',
      actorUserId: a.userId,
      actorRole: 'OWNER',
    });
    const effective = await qa.resolveEffectiveApproval({
      workspaceId: a.workspaceId,
      assetVersionId: a.versionId,
      qaReportId: report.id,
      truthRevisionId: a.truthRevId,
      shotBriefRevisionId: null,
      inputFingerprint: 'fp1',
      overallStatus: 'PASS',
      findings: [finding],
    });
    expect(effective?.decision).toBe('APPROVE');

    const stale = computeEffectiveApproval(
      effective
        ? [
            {
              ...effective,
            },
          ]
        : [],
      {
        assetVersionId: a.versionId,
        qaReportId: report.id,
        truthRevisionId: newId(),
        shotBriefRevisionId: null,
        overallStatus: 'PASS',
        findings: [finding],
      },
    );
    expect(stale).toBeNull();

    expect(
      assertExportAllowed([
        { slot: 'MAIN', overallStatus: 'PASS', findings: [finding], effective },
      ]).ok,
    ).toBe(true);
  });
});
