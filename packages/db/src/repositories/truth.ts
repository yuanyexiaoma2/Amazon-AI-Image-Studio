import type {
  FactStatus,
  PrismaClient,
  ProductConstraint,
  ProductFact,
  ProductTruthDocument,
  ProductTruthRevision,
  TruthRevisionStatus,
} from '@prisma/client';
import { newId } from '../ids.js';

export type SaveTruthRevisionInput = {
  workspaceId: string;
  projectId: string;
  createdByUserId: string;
  facts: Array<{
    key: string;
    value: unknown;
    confidence?: number;
    status?: FactStatus;
    evidenceAssetVersionIds?: string[];
  }>;
  locks?: string[];
  allowedChanges?: string[];
};

export class TruthPackRepository {
  constructor(private readonly db: PrismaClient) {}

  async getDocument(
    workspaceId: string,
    projectId: string,
  ): Promise<ProductTruthDocument | null> {
    return this.db.productTruthDocument.findFirst({
      where: { workspaceId, projectId },
    });
  }

  async ensureDocument(
    workspaceId: string,
    projectId: string,
  ): Promise<ProductTruthDocument> {
    const existing = await this.getDocument(workspaceId, projectId);
    if (existing) return existing;
    return this.db.productTruthDocument.create({
      data: {
        id: newId(),
        workspaceId,
        projectId,
      },
    });
  }

  async getRevisionWithDetails(workspaceId: string, revisionId: string) {
    return this.db.productTruthRevision.findFirst({
      where: { id: revisionId, workspaceId },
      include: { facts: true, constraints: true },
    });
  }

  async saveNewRevision(input: SaveTruthRevisionInput): Promise<{
    document: ProductTruthDocument;
    revision: ProductTruthRevision & {
      facts: ProductFact[];
      constraints: ProductConstraint[];
    };
  }> {
    const document = await this.ensureDocument(input.workspaceId, input.projectId);

    return this.db.$transaction(async (tx) => {
      const last = await tx.productTruthRevision.findFirst({
        where: { workspaceId: input.workspaceId, documentId: document.id },
        orderBy: { revision: 'desc' },
      });
      const nextRev = (last?.revision ?? 0) + 1;

      if (last && last.status === 'DRAFT') {
        await tx.productTruthRevision.updateMany({
          where: { id: last.id, workspaceId: input.workspaceId },
          data: { status: 'SUPERSEDED' },
        });
      }

      const revision = await tx.productTruthRevision.create({
        data: {
          id: newId(),
          workspaceId: input.workspaceId,
          documentId: document.id,
          revision: nextRev,
          status: 'DRAFT',
          createdByUserId: input.createdByUserId,
        },
      });

      for (const f of input.facts) {
        await tx.productFact.create({
          data: {
            id: newId(),
            workspaceId: input.workspaceId,
            truthRevisionId: revision.id,
            key: f.key,
            valueJson: f.value as object,
            confidence: f.confidence ?? 0,
            status: f.status ?? 'EXTRACTED',
            evidenceAssetVersionIds: f.evidenceAssetVersionIds ?? [],
          },
        });
      }

      for (const path of input.locks ?? []) {
        await tx.productConstraint.create({
          data: {
            id: newId(),
            workspaceId: input.workspaceId,
            truthRevisionId: revision.id,
            kind: 'LOCK',
            path,
            rule: 'must_preserve',
            severity: 'MUST',
          },
        });
      }
      for (const path of input.allowedChanges ?? []) {
        await tx.productConstraint.create({
          data: {
            id: newId(),
            workspaceId: input.workspaceId,
            truthRevisionId: revision.id,
            kind: 'ALLOW',
            path,
            rule: 'may_change',
            severity: 'INFO',
          },
        });
      }

      await tx.productTruthDocument.updateMany({
        where: { id: document.id, workspaceId: input.workspaceId },
        data: { currentRevisionId: revision.id },
      });
      const updatedDoc = await tx.productTruthDocument.findFirstOrThrow({
        where: { id: document.id, workspaceId: input.workspaceId },
      });

      const full = await tx.productTruthRevision.findFirstOrThrow({
        where: { id: revision.id, workspaceId: input.workspaceId },
        include: { facts: true, constraints: true },
      });

      return { document: updatedDoc, revision: full };
    });
  }

  async updateFactStatuses(
    workspaceId: string,
    updates: Array<{ factId: string; status: FactStatus }>,
  ): Promise<ProductFact[]> {
    const results: ProductFact[] = [];
    for (const u of updates) {
      const existing = await this.db.productFact.findFirst({
        where: { id: u.factId, workspaceId },
      });
      if (!existing) throw new Error(`Fact not found: ${u.factId}`);
      await this.db.productFact.updateMany({
        where: { id: u.factId, workspaceId },
        data: { status: u.status },
      });
      const updated = await this.db.productFact.findFirstOrThrow({
        where: { id: u.factId, workspaceId },
      });
      results.push(updated);
    }
    return results;
  }

  async setRevisionStatus(
    workspaceId: string,
    revisionId: string,
    status: TruthRevisionStatus,
  ): Promise<void> {
    await this.db.productTruthRevision.updateMany({
      where: { id: revisionId, workspaceId },
      data: { status },
    });
  }

  async approveRevision(
    workspaceId: string,
    projectId: string,
    revisionId: string,
    approvedByUserId: string,
  ): Promise<ProductTruthRevision> {
    const document = await this.getDocument(workspaceId, projectId);
    if (!document) throw new Error('Document not found');

    const revision = await this.db.productTruthRevision.findFirst({
      where: { id: revisionId, workspaceId, documentId: document.id },
      include: { facts: true },
    });
    if (!revision) throw new Error('Revision not found');
    if (document.currentRevisionId !== revisionId) {
      throw new Error('Only the current revision can be approved');
    }
    if (revision.status !== 'PENDING_REVIEW') {
      throw new Error(`Revision status must be PENDING_REVIEW (got ${revision.status})`);
    }

    return this.db.$transaction(async (tx) => {
      await tx.productTruthRevision.updateMany({
        where: { id: revisionId, workspaceId },
        data: {
          status: 'APPROVED' satisfies TruthRevisionStatus,
          approvedByUserId,
          approvedAt: new Date(),
        },
      });
      await tx.productTruthDocument.updateMany({
        where: { id: document.id, workspaceId, projectId },
        data: {
          approvedRevisionId: revisionId,
          currentRevisionId: revisionId,
        },
      });
      return tx.productTruthRevision.findFirstOrThrow({
        where: { id: revisionId, workspaceId },
      });
    });
  }
}
