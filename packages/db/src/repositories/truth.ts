import type {
  FactStatus,
  Prisma,
  PrismaClient,
  ProductConstraint,
  ProductFact,
  ProductTruthDocument,
  ProductTruthRevision,
  TruthRevisionStatus,
} from '@prisma/client';
import { canApproveTruthRevision, type FactStatus as DomainFactStatus } from '@studio/domain';
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

export class TruthPackConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TruthPackConflictError';
  }
}

export class TruthPackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TruthPackValidationError';
  }
}

export class TruthPackForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TruthPackForbiddenError';
  }
}

export class TruthPackNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TruthPackNotFoundError';
  }
}

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
      // Serialize current-pointer moves against concurrent approve
      await tx.$queryRaw`
        SELECT id FROM product_truth_documents
        WHERE id = ${document.id}::uuid AND workspace_id = ${input.workspaceId}::uuid
        FOR UPDATE
      `;

      const last = await tx.productTruthRevision.findFirst({
        where: { workspaceId: input.workspaceId, documentId: document.id },
        orderBy: { revision: 'desc' },
      });
      const nextRev = (last?.revision ?? 0) + 1;

      if (last && last.status === 'DRAFT') {
        await tx.productTruthRevision.updateMany({
          where: { id: last.id, workspaceId: input.workspaceId, status: 'DRAFT' },
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

      const docUpdate = await tx.productTruthDocument.updateMany({
        where: { id: document.id, workspaceId: input.workspaceId },
        data: { currentRevisionId: revision.id },
      });
      if (docUpdate.count !== 1) {
        throw new TruthPackConflictError('Failed to advance current revision pointer');
      }
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
    return this.db.$transaction(async (tx) => {
      const results: ProductFact[] = [];
      for (const u of updates) {
        const existing = await tx.productFact.findFirst({
          where: { id: u.factId, workspaceId },
        });
        if (!existing) throw new TruthPackNotFoundError(`Fact not found: ${u.factId}`);

        // Lock parent revision so we serialize against approve
        await tx.$queryRaw`
          SELECT id FROM product_truth_revisions
          WHERE id = ${existing.truthRevisionId}::uuid AND workspace_id = ${workspaceId}::uuid
          FOR UPDATE
        `;
        const rev = await tx.productTruthRevision.findFirstOrThrow({
          where: { id: existing.truthRevisionId, workspaceId },
        });
        if (rev.status === 'APPROVED') {
          throw new TruthPackConflictError('Cannot modify facts on an approved revision');
        }

        const updatedRows = await tx.productFact.updateMany({
          where: {
            id: u.factId,
            workspaceId,
            truthRevisionId: existing.truthRevisionId,
          },
          data: { status: u.status },
        });
        if (updatedRows.count !== 1) {
          throw new TruthPackConflictError(`Fact update conflict: ${u.factId}`);
        }
        const updated = await tx.productFact.findFirstOrThrow({
          where: { id: u.factId, workspaceId },
        });
        results.push(updated);
      }
      return results;
    });
  }

  async setRevisionStatus(
    workspaceId: string,
    revisionId: string,
    status: TruthRevisionStatus,
  ): Promise<void> {
    const result = await this.db.productTruthRevision.updateMany({
      where: {
        id: revisionId,
        workspaceId,
        status: { notIn: ['APPROVED', 'SUPERSEDED'] },
      },
      data: { status },
    });
    if (result.count !== 1) {
      throw new TruthPackConflictError(
        `Cannot set revision status to ${status} (missing or already approved/superseded)`,
      );
    }
  }

  /**
   * Atomic approve: under one transaction/lock, re-check current revision,
   * PENDING_REVIEW, fact gates, and evidence tenancy; then conditional updates
   * with affected-row checks so concurrent create-revision / fact mutation
   * allow at most one successful approve.
   */
  async approveRevision(
    workspaceId: string,
    projectId: string,
    revisionId: string,
    approvedByUserId: string,
  ): Promise<ProductTruthRevision> {
    return this.db.$transaction(async (tx) => {
      const lockedDocs = await tx.$queryRaw<
        Array<{
          id: string;
          current_revision_id: string | null;
          approved_revision_id: string | null;
        }>
      >`
        SELECT id, current_revision_id, approved_revision_id
        FROM product_truth_documents
        WHERE workspace_id = ${workspaceId}::uuid AND project_id = ${projectId}::uuid
        FOR UPDATE
      `;
      const lockedDoc = lockedDocs[0];
      if (!lockedDoc) throw new TruthPackNotFoundError('Document not found');

      const lockedRevs = await tx.$queryRaw<
        Array<{ id: string; status: string; document_id: string }>
      >`
        SELECT id, status, document_id
        FROM product_truth_revisions
        WHERE id = ${revisionId}::uuid AND workspace_id = ${workspaceId}::uuid
        FOR UPDATE
      `;
      const lockedRev = lockedRevs[0];
      if (!lockedRev) throw new TruthPackNotFoundError('Revision not found');
      if (lockedRev.document_id !== lockedDoc.id) {
        throw new TruthPackForbiddenError('Revision does not belong to this project');
      }
      if (lockedDoc.current_revision_id !== revisionId) {
        throw new TruthPackConflictError('Only the current revision can be approved');
      }
      if (lockedRev.status !== 'PENDING_REVIEW') {
        throw new TruthPackConflictError(
          `Revision status must be PENDING_REVIEW (got ${lockedRev.status})`,
        );
      }

      const facts = await tx.productFact.findMany({
        where: { workspaceId, truthRevisionId: revisionId },
      });
      const gate = canApproveTruthRevision(
        facts.map((f) => ({ status: f.status as DomainFactStatus })),
      );
      if (!gate.ok) {
        throw new TruthPackValidationError(gate.reason);
      }

      const evidenceIds = new Set<string>();
      for (const fact of facts) {
        const ids = fact.evidenceAssetVersionIds;
        if (Array.isArray(ids)) {
          for (const id of ids) {
            if (typeof id === 'string') evidenceIds.add(id);
          }
        }
      }
      if (evidenceIds.size > 0) {
        await this.assertEvidenceInProjectTx(tx, workspaceId, projectId, [...evidenceIds]);
      }

      const revUpdate = await tx.productTruthRevision.updateMany({
        where: {
          id: revisionId,
          workspaceId,
          documentId: lockedDoc.id,
          status: 'PENDING_REVIEW',
        },
        data: {
          status: 'APPROVED' satisfies TruthRevisionStatus,
          approvedByUserId,
          approvedAt: new Date(),
        },
      });
      if (revUpdate.count !== 1) {
        throw new TruthPackConflictError(
          'Approve conflict: revision conditional update affected 0 rows',
        );
      }

      const docUpdate = await tx.productTruthDocument.updateMany({
        where: {
          id: lockedDoc.id,
          workspaceId,
          projectId,
          currentRevisionId: revisionId,
        },
        data: {
          approvedRevisionId: revisionId,
          currentRevisionId: revisionId,
        },
      });
      if (docUpdate.count !== 1) {
        throw new TruthPackConflictError(
          'Approve conflict: document conditional update affected 0 rows (not current)',
        );
      }

      return tx.productTruthRevision.findFirstOrThrow({
        where: { id: revisionId, workspaceId },
      });
    });
  }

  private async assertEvidenceInProjectTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    versionIds: string[],
  ): Promise<void> {
    const unique = [...new Set(versionIds)];
    const rows = await tx.assetVersion.findMany({
      where: {
        workspaceId,
        id: { in: unique },
        asset: { workspaceId, projectId, deletedAt: null },
      },
      select: { id: true },
    });
    if (rows.length !== unique.length) {
      throw new TruthPackForbiddenError(
        'Evidence Asset Version not in current project/workspace',
      );
    }
  }
}
