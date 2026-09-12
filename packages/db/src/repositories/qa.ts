import { Prisma } from '@prisma/client';
import type {
  Approval,
  ApprovalDecision,
  PrismaClient,
  QaFinding,
  QaFindingStatus,
  QaJobStatus,
  QaReport,
  QaReportOverallStatus,
} from '@prisma/client';
import {
  AMAZON_MAIN_US_V1,
  builtinAmazonMainUsV1Merged,
  computeEffectiveApproval,
  type ApprovalRecord,
  type QaFinding as DomainFinding,
  type QaReportOverallStatus as DomainOverall,
} from '@studio/domain';
import { newId } from '../ids.js';

export class QaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QaValidationError';
  }
}

export class QaNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QaNotFoundError';
  }
}

export class QaConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QaConflictError';
  }
}

export type CreateQaReportInput = {
  workspaceId: string;
  projectId: string;
  assetVersionId: string;
  createdByUserId: string;
  slot?: string | null;
  shotBriefId?: string | null;
  truthRevisionId?: string | null;
  workflowRevisionId?: string | null;
  policyKey?: string;
  ocrScenario?: string | null;
  visionScenario?: string | null;
};

export type PersistFindingsInput = {
  workspaceId: string;
  reportId: string;
  overallStatus: DomainOverall;
  findings: DomainFinding[];
  inputFingerprint: string;
  ocrSnapshot: Prisma.InputJsonValue;
  visionSnapshot: Prisma.InputJsonValue;
};

function toDomainFinding(row: QaFinding): DomainFinding {
  return {
    ruleId: row.ruleId,
    ruleVersion: row.ruleVersion,
    evaluator: row.evaluator,
    status: row.status,
    severity: row.severity as DomainFinding['severity'],
    nonWaivable: row.nonWaivable,
    score: row.score,
    message: row.message,
    evidence: row.evidenceJson as DomainFinding['evidence'],
    suggestedAction: row.suggestedAction,
  };
}

function toApprovalRecord(row: Approval): ApprovalRecord {
  return {
    id: row.id,
    assetVersionId: row.assetVersionId,
    qaReportId: row.qaReportId,
    truthRevisionId: row.truthRevisionId,
    shotBriefRevisionId: row.shotBriefRevisionId,
    workflowRevisionId: row.workflowRevisionId,
    inputFingerprint: row.inputFingerprint,
    decision: row.decision,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    reason: row.reason,
    decidedAt: row.decidedAt.toISOString(),
  };
}

export class QaRepository {
  constructor(private readonly db: PrismaClient) {}

  async ensureBuiltinRulePack(): Promise<{ sha256: string; version: number }> {
    const { pack, sha256 } = builtinAmazonMainUsV1Merged();
    const existing = await this.db.globalMarketRuleDefinition.findFirst({
      where: { key: pack.key, version: pack.version },
    });
    if (!existing) {
      await this.db.globalMarketRuleDefinition.create({
        data: {
          id: newId(),
          key: pack.key,
          version: pack.version,
          marketplaceCode: pack.marketplaceCode,
          scopeJson: pack.scope as Prisma.InputJsonValue,
          priority: pack.priority,
          effectiveDate: new Date(`${pack.effectiveDate}T00:00:00.000Z`),
          rulesJson: pack.rules as Prisma.InputJsonValue,
          sourceUrlsJson: pack.sourceUrls as Prisma.InputJsonValue,
          contentSha256: sha256,
        },
      });
    }
    const act = await this.db.globalMarketRuleActivation.findFirst({
      where: { key: pack.key, environment: 'local' },
    });
    if (!act) {
      await this.db.globalMarketRuleActivation.create({
        data: {
          id: newId(),
          key: pack.key,
          version: pack.version,
          environment: 'local',
          enabled: true,
        },
      });
    }
    return { sha256, version: pack.version };
  }

  async createQueuedReport(
    input: CreateQaReportInput,
    tx?: Prisma.TransactionClient,
  ): Promise<QaReport> {
    const db = tx ?? this.db;
    const key = input.policyKey ?? 'amazon-main-us-v1';
    if (key !== 'amazon-main-us-v1') {
      throw new QaValidationError(`Unknown policyKey ${key}`);
    }
    await this.ensureBuiltinRulePack();
    const { pack, sha256 } = builtinAmazonMainUsV1Merged();
    return db.qaReport.create({
      data: {
        id: newId(),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        assetVersionId: input.assetVersionId,
        slot: input.slot ?? 'MAIN',
        shotBriefId: input.shotBriefId ?? null,
        truthRevisionId: input.truthRevisionId ?? null,
        workflowRevisionId: input.workflowRevisionId ?? null,
        rulePackKey: pack.key,
        rulePackVersion: pack.version,
        rulePackSnapshotJson: pack as unknown as Prisma.InputJsonValue,
        rulePackSha256: sha256,
        status: 'QUEUED',
        ocrScenario: input.ocrScenario ?? null,
        visionScenario: input.visionScenario ?? null,
        createdByUserId: input.createdByUserId,
      },
    });
  }

  async getReport(workspaceId: string, reportId: string) {
    return this.db.qaReport.findFirst({
      where: { id: reportId, workspaceId },
      include: { findings: { orderBy: { ruleId: 'asc' } } },
    });
  }

  async listReportsForProject(workspaceId: string, projectId: string) {
    return this.db.qaReport.findMany({
      where: { workspaceId, projectId },
      include: { findings: { orderBy: { ruleId: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async listReportsForVersion(workspaceId: string, assetVersionId: string) {
    return this.db.qaReport.findMany({
      where: { workspaceId, assetVersionId },
      include: { findings: { orderBy: { ruleId: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRunning(workspaceId: string, reportId: string): Promise<void> {
    await this.db.qaReport.updateMany({
      where: { id: reportId, workspaceId, status: { in: ['QUEUED', 'FAILED'] satisfies QaJobStatus[] } },
      data: { status: 'RUNNING' },
    });
  }

  async markFailed(workspaceId: string, reportId: string, message: string): Promise<void> {
    await this.db.qaReport.updateMany({
      where: { id: reportId, workspaceId },
      data: {
        status: 'FAILED',
        errorJson: { message },
        completedAt: new Date(),
      },
    });
  }

  async persistFindings(input: PersistFindingsInput): Promise<QaReport> {
    const existing = await this.db.qaReport.findFirst({
      where: { id: input.reportId, workspaceId: input.workspaceId },
    });
    if (!existing) throw new QaNotFoundError('QA report not found');

    await this.db.$transaction(async (tx) => {
      await tx.qaFinding.deleteMany({
        where: { workspaceId: input.workspaceId, reportId: input.reportId },
      });
      if (input.findings.length > 0) {
        await tx.qaFinding.createMany({
          data: input.findings.map((f) => ({
            id: newId(),
            workspaceId: input.workspaceId,
            reportId: input.reportId,
            ruleId: f.ruleId,
            ruleVersion: f.ruleVersion,
            evaluator: f.evaluator,
            status: f.status as QaFindingStatus,
            severity: f.severity,
            nonWaivable: f.nonWaivable,
            score: f.score ?? null,
            message: f.message,
            evidenceJson: f.evidence as Prisma.InputJsonValue,
            suggestedAction: f.suggestedAction ?? null,
          })),
        });
      }
      await tx.qaReport.updateMany({
        where: { id: input.reportId, workspaceId: input.workspaceId },
        data: {
          status: 'SUCCEEDED',
          overallStatus: input.overallStatus as QaReportOverallStatus,
          inputFingerprint: input.inputFingerprint,
          ocrSnapshotJson: input.ocrSnapshot,
          visionSnapshotJson: input.visionSnapshot,
          completedAt: new Date(),
          errorJson: Prisma.DbNull,
        },
      });
    });

    const refreshed = await this.getReport(input.workspaceId, input.reportId);
    if (!refreshed) throw new QaNotFoundError('QA report missing after persist');
    return refreshed;
  }

  async appendApproval(input: {
    workspaceId: string;
    projectId: string;
    assetVersionId: string;
    qaReportId: string;
    truthRevisionId: string;
    shotBriefRevisionId?: string | null;
    workflowRevisionId?: string | null;
    inputFingerprint?: string | null;
    decision: ApprovalDecision;
    actorUserId: string;
    actorRole: string;
    reason?: string | null;
  }): Promise<Approval> {
    return this.db.approval.create({
      data: {
        id: newId(),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        assetVersionId: input.assetVersionId,
        qaReportId: input.qaReportId,
        truthRevisionId: input.truthRevisionId,
        shotBriefRevisionId: input.shotBriefRevisionId ?? null,
        workflowRevisionId: input.workflowRevisionId ?? null,
        inputFingerprint: input.inputFingerprint ?? null,
        decision: input.decision,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        reason: input.reason ?? null,
      },
    });
  }

  async listApprovalsForVersion(workspaceId: string, assetVersionId: string) {
    return this.db.approval.findMany({
      where: { workspaceId, assetVersionId },
      orderBy: { decidedAt: 'asc' },
    });
  }

  async listApprovalsForReport(workspaceId: string, qaReportId: string) {
    return this.db.approval.findMany({
      where: { workspaceId, qaReportId },
      orderBy: { decidedAt: 'asc' },
    });
  }

  domainFindings(rows: QaFinding[]): DomainFinding[] {
    return rows.map(toDomainFinding);
  }

  async resolveEffectiveApproval(input: {
    workspaceId: string;
    assetVersionId: string;
    qaReportId: string;
    truthRevisionId: string;
    shotBriefRevisionId: string | null;
    workflowRevisionId?: string | null;
    inputFingerprint?: string | null;
    overallStatus: DomainOverall;
    findings: DomainFinding[];
  }): Promise<ApprovalRecord | null> {
    const rows = await this.listApprovalsForReport(input.workspaceId, input.qaReportId);
    return computeEffectiveApproval(rows.map(toApprovalRecord), {
      assetVersionId: input.assetVersionId,
      qaReportId: input.qaReportId,
      truthRevisionId: input.truthRevisionId,
      shotBriefRevisionId: input.shotBriefRevisionId,
      workflowRevisionId: input.workflowRevisionId,
      inputFingerprint: input.inputFingerprint,
      overallStatus: input.overallStatus,
      findings: input.findings,
    });
  }

  builtinRuleCount(): number {
    return AMAZON_MAIN_US_V1.rules.length;
  }
}
