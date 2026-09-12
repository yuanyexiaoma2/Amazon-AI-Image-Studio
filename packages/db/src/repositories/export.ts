import { Prisma } from '@prisma/client';
import type { ExportBundle, ExportBundleStatus, PrismaClient } from '@prisma/client';
import { newId } from '../ids.js';

export class ExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportValidationError';
  }
}

export class ExportNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportNotFoundError';
  }
}

export type CreateExportItemInput = {
  assetVersionId: string;
  qaReportId: string;
  approvalId: string;
  slot: string;
  variantCode: string;
  path: string;
  sha256: string;
  bytes: number;
  mime: string;
  outputIndex: number;
};

export class ExportRepository {
  constructor(private readonly db: PrismaClient) {}

  async createQueued(
    input: {
    workspaceId: string;
    projectId: string;
    sku: string;
    marketplaceCode: string;
    truthRevisionId: string | null;
    rulePackKey: string;
    rulePackVersion: number;
    createdByUserId: string;
    items: CreateExportItemInput[];
  },
    tx?: Prisma.TransactionClient,
  ): Promise<ExportBundle> {
    const run = async (tx: Prisma.TransactionClient) => {
      const bundle = await tx.exportBundle.create({
        data: {
          id: newId(),
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: 'QUEUED',
          sku: input.sku,
          marketplaceCode: input.marketplaceCode,
          truthRevisionId: input.truthRevisionId,
          rulePackKey: input.rulePackKey,
          rulePackVersion: input.rulePackVersion,
          createdByUserId: input.createdByUserId,
        },
      });
      if (input.items.length > 0) {
        await tx.exportBundleItem.createMany({
          data: input.items.map((it) => ({
            id: newId(),
            workspaceId: input.workspaceId,
            bundleId: bundle.id,
            assetVersionId: it.assetVersionId,
            qaReportId: it.qaReportId,
            approvalId: it.approvalId,
            slot: it.slot,
            variantCode: it.variantCode,
            path: it.path,
            sha256: it.sha256,
            bytes: it.bytes,
            mime: it.mime,
            outputIndex: it.outputIndex,
          })),
        });
      }
      return bundle;
    };
    if (tx) return run(tx);
    return this.db.$transaction(run);
  }

  async getBundle(workspaceId: string, bundleId: string) {
    return this.db.exportBundle.findFirst({
      where: { id: bundleId, workspaceId },
      include: { items: { orderBy: { outputIndex: 'asc' } } },
    });
  }

  async listByProject(workspaceId: string, projectId: string) {
    return this.db.exportBundle.findMany({
      where: { workspaceId, projectId },
      include: { items: { orderBy: { outputIndex: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRunning(workspaceId: string, bundleId: string): Promise<void> {
    await this.db.exportBundle.updateMany({
      where: { id: bundleId, workspaceId, status: { in: ['QUEUED', 'FAILED'] satisfies ExportBundleStatus[] } },
      data: { status: 'RUNNING' },
    });
  }

  async markFailed(workspaceId: string, bundleId: string, message: string): Promise<void> {
    await this.db.exportBundle.updateMany({
      where: { id: bundleId, workspaceId },
      data: { status: 'FAILED', errorJson: { message }, completedAt: new Date() },
    });
  }

  async markSucceeded(input: {
    workspaceId: string;
    bundleId: string;
    manifestJson: Prisma.InputJsonValue;
    manifestSha256: string;
    zipStorageKey: string;
    zipSha256: string;
    zipBytes: number;
  }): Promise<void> {
    await this.db.exportBundle.updateMany({
      where: { id: input.bundleId, workspaceId: input.workspaceId },
      data: {
        status: 'SUCCEEDED',
        manifestJson: input.manifestJson,
        manifestSha256: input.manifestSha256,
        zipStorageKey: input.zipStorageKey,
        zipSha256: input.zipSha256,
        zipBytes: input.zipBytes,
        completedAt: new Date(),
        errorJson: Prisma.DbNull,
      },
    });
  }
}
