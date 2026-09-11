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
        await tx.productTruthRevision.update({
          where: { id: last.id },
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

      const updatedDoc = await tx.productTruthDocument.update({
        where: { id: document.id },
        data: { currentRevisionId: revision.id },
      });

      const full = await tx.productTruthRevision.findFirstOrThrow({
        where: { id: revision.id },
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
      const updated = await this.db.productFact.update({
        where: { id: u.factId },
        data: { status: u.status },
      });
      results.push(updated);
    }
    return results;
  }

  async approveRevision(
    workspaceId: string,
    revisionId: string,
    approvedByUserId: string,
  ): Promise<ProductTruthRevision> {
    const revision = await this.db.productTruthRevision.findFirst({
      where: { id: revisionId, workspaceId },
      include: { facts: true },
    });
    if (!revision) throw new Error('Revision not found');

    return this.db.$transaction(async (tx) => {
      const approved = await tx.productTruthRevision.update({
        where: { id: revisionId },
        data: {
          status: 'APPROVED' satisfies TruthRevisionStatus,
          approvedByUserId,
          approvedAt: new Date(),
        },
      });
      await tx.productTruthDocument.update({
        where: { id: revision.documentId },
        data: {
          approvedRevisionId: revisionId,
          currentRevisionId: revisionId,
        },
      });
      return approved;
    });
  }
}
