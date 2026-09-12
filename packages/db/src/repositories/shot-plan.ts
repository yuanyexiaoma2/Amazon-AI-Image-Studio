import type {
  PrismaClient,
  ShotBrief,
  ShotBriefSlot,
  ShotPlanDocument,
  ShotPlanRevision,
  ShotPlanRevisionStatus,
} from '@prisma/client';
import {
  canApproveShotPlanRevision,
  canGenerateShotPlan,
  type ShotBriefSlot as DomainSlot,
} from '@studio/domain';
import { newId } from '../ids.js';

export type ShotBriefInput = {
  slot: ShotBriefSlot | DomainSlot | string;
  purpose: string;
  orderIndex: number;
  copy?: unknown[];
  must?: string[];
  mustNot?: string[];
  qaPolicy?: string;
  aspectRatio?: string;
  targetPixels?: { width: number; height: number };
  referencedAssetVersionIds?: string[];
};

export type SaveShotPlanRevisionInput = {
  workspaceId: string;
  projectId: string;
  createdByUserId: string;
  truthRevisionId: string;
  briefs: ShotBriefInput[];
  /** When true (default), revision is PENDING_REVIEW (ready for approve). */
  readyForReview?: boolean;
  provider?: string | null;
  modelId?: string | null;
  actorUserId?: string;
  auditAction?: string;
};

export class ShotPlanConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShotPlanConflictError';
  }
}

export class ShotPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShotPlanValidationError';
  }
}

export class ShotPlanForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShotPlanForbiddenError';
  }
}

export class ShotPlanNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShotPlanNotFoundError';
  }
}

function constraintsFromBrief(b: ShotBriefInput): Record<string, unknown> {
  return {
    must: b.must ?? [],
    mustNot: b.mustNot ?? [],
    qaPolicy: b.qaPolicy ?? 'amazon-generic-us-v1',
    aspectRatio: b.aspectRatio ?? '1:1',
    targetPixels: b.targetPixels ?? { width: 2000, height: 2000 },
    referencedAssetVersionIds: b.referencedAssetVersionIds ?? [],
  };
}

export class ShotPlanRepository {
  constructor(private readonly db: PrismaClient) {}

  async getDocument(
    workspaceId: string,
    projectId: string,
  ): Promise<ShotPlanDocument | null> {
    return this.db.shotPlanDocument.findFirst({
      where: { workspaceId, projectId },
    });
  }

  async ensureDocument(
    workspaceId: string,
    projectId: string,
  ): Promise<ShotPlanDocument> {
    const existing = await this.getDocument(workspaceId, projectId);
    if (existing) return existing;
    return this.db.shotPlanDocument.create({
      data: {
        id: newId(),
        workspaceId,
        projectId,
      },
    });
  }

  async getRevisionWithBriefs(workspaceId: string, revisionId: string) {
    return this.db.shotPlanRevision.findFirst({
      where: { id: revisionId, workspaceId },
      include: { briefs: { orderBy: { orderIndex: 'asc' } } },
    });
  }

  /**
   * Require an approved Truth Pack revision for this project (MSG-003 FK provenance).
   */
  async requireApprovedTruthRevision(
    workspaceId: string,
    projectId: string,
    truthRevisionId?: string,
  ): Promise<{ truthRevisionId: string }> {
    const doc = await this.db.productTruthDocument.findFirst({
      where: { workspaceId, projectId },
    });
    if (!doc?.approvedRevisionId) {
      throw new ShotPlanValidationError(
        'Cannot generate/approve Shot Plan without an approved Truth Pack revision (W2-06)',
      );
    }
    const approvedId = doc.approvedRevisionId;
    if (truthRevisionId && truthRevisionId !== approvedId) {
      throw new ShotPlanValidationError(
        'truthRevisionId must be the project approved Truth Pack revision',
      );
    }
    const rev = await this.db.productTruthRevision.findFirst({
      where: { id: approvedId, workspaceId, status: 'APPROVED' },
    });
    if (!rev) {
      throw new ShotPlanValidationError('Approved Truth Pack revision not found or not APPROVED');
    }
    return { truthRevisionId: approvedId };
  }

  async saveNewRevision(input: SaveShotPlanRevisionInput): Promise<{
    document: ShotPlanDocument;
    revision: ShotPlanRevision & { briefs: ShotBrief[] };
  }> {
    const gate = canGenerateShotPlan({ hasApprovedTruthRevision: true });
    // Caller must pass a verified approved truthRevisionId; re-check below.
    void gate;

    await this.requireApprovedTruthRevision(
      input.workspaceId,
      input.projectId,
      input.truthRevisionId,
    );

    if (!input.briefs.length) {
      throw new ShotPlanValidationError('Shot Plan requires at least one brief');
    }
    if (!input.briefs.some((b) => b.slot === 'MAIN')) {
      throw new ShotPlanValidationError('Shot Plan must include a MAIN brief');
    }

    const document = await this.ensureDocument(input.workspaceId, input.projectId);
    const ready = input.readyForReview !== false;
    const status: ShotPlanRevisionStatus = ready ? 'PENDING_REVIEW' : 'DRAFT';

    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM shot_plan_documents
        WHERE id = ${document.id}::uuid AND workspace_id = ${input.workspaceId}::uuid
        FOR UPDATE
      `;

      const last = await tx.shotPlanRevision.findFirst({
        where: { workspaceId: input.workspaceId, documentId: document.id },
        orderBy: { revision: 'desc' },
      });
      const nextRev = (last?.revision ?? 0) + 1;

      if (last && (last.status === 'DRAFT' || last.status === 'PENDING_REVIEW')) {
        await tx.shotPlanRevision.updateMany({
          where: {
            id: last.id,
            workspaceId: input.workspaceId,
            status: { in: ['DRAFT', 'PENDING_REVIEW'] },
          },
          data: { status: 'SUPERSEDED' },
        });
      }

      const revision = await tx.shotPlanRevision.create({
        data: {
          id: newId(),
          workspaceId: input.workspaceId,
          documentId: document.id,
          revision: nextRev,
          status,
          truthRevisionId: input.truthRevisionId,
          createdByUserId: input.createdByUserId,
          provider: input.provider ?? null,
          modelId: input.modelId ?? null,
        },
      });

      for (const b of input.briefs) {
        await tx.shotBrief.create({
          data: {
            id: newId(),
            workspaceId: input.workspaceId,
            shotPlanRevisionId: revision.id,
            slot: b.slot as ShotBriefSlot,
            purpose: b.purpose,
            orderIndex: b.orderIndex,
            copyJson: (b.copy ?? []) as object[],
            constraintsJson: constraintsFromBrief(b) as object,
          },
        });
      }

      const docUpdate = await tx.shotPlanDocument.updateMany({
        where: { id: document.id, workspaceId: input.workspaceId },
        data: { currentRevisionId: revision.id },
      });
      if (docUpdate.count !== 1) {
        throw new ShotPlanConflictError('Failed to advance current Shot Plan revision pointer');
      }

      await tx.auditEvent.create({
        data: {
          id: newId(),
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId ?? input.createdByUserId,
          action: input.auditAction ?? 'shot_plan.revision_saved',
          subjectType: 'shot_plan_revision',
          subjectId: revision.id,
          metadataJson: {
            projectId: input.projectId,
            documentId: document.id,
            truthRevisionId: input.truthRevisionId,
            status,
            briefCount: input.briefs.length,
          },
        },
      });

      const updatedDoc = await tx.shotPlanDocument.findFirstOrThrow({
        where: { id: document.id, workspaceId: input.workspaceId },
      });
      const full = await tx.shotPlanRevision.findFirstOrThrow({
        where: { id: revision.id, workspaceId: input.workspaceId },
        include: { briefs: { orderBy: { orderIndex: 'asc' } } },
      });
      return { document: updatedDoc, revision: full };
    });
  }

  /**
   * Atomic approve — copy W2 Truth approve structure:
   * FOR UPDATE document+revision, PENDING_REVIEW + current pointer + domain gates,
   * conditional updates with row-count checks, audit event.
   */
  async approveRevision(
    workspaceId: string,
    projectId: string,
    revisionId: string,
    approvedByUserId: string,
  ): Promise<ShotPlanRevision & { briefs: ShotBrief[] }> {
    const { truthRevisionId: approvedTruthId } = await this.requireApprovedTruthRevision(
      workspaceId,
      projectId,
    );

    return this.db.$transaction(async (tx) => {
      const lockedDocs = await tx.$queryRaw<
        Array<{
          id: string;
          current_revision_id: string | null;
          approved_revision_id: string | null;
        }>
      >`
        SELECT id, current_revision_id, approved_revision_id
        FROM shot_plan_documents
        WHERE workspace_id = ${workspaceId}::uuid AND project_id = ${projectId}::uuid
        FOR UPDATE
      `;
      const lockedDoc = lockedDocs[0];
      if (!lockedDoc) throw new ShotPlanNotFoundError('Shot Plan document not found');

      const lockedRevs = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          document_id: string;
          truth_revision_id: string;
        }>
      >`
        SELECT id, status, document_id, truth_revision_id
        FROM shot_plan_revisions
        WHERE id = ${revisionId}::uuid AND workspace_id = ${workspaceId}::uuid
        FOR UPDATE
      `;
      const lockedRev = lockedRevs[0];
      if (!lockedRev) throw new ShotPlanNotFoundError('Shot Plan revision not found');
      if (lockedRev.document_id !== lockedDoc.id) {
        throw new ShotPlanForbiddenError('Revision does not belong to this project');
      }
      if (lockedDoc.current_revision_id !== revisionId) {
        throw new ShotPlanConflictError('Only the current Shot Plan revision can be approved');
      }
      if (lockedRev.status !== 'PENDING_REVIEW') {
        throw new ShotPlanConflictError(
          `Shot Plan revision status must be PENDING_REVIEW (got ${lockedRev.status})`,
        );
      }
      if (lockedRev.truth_revision_id !== approvedTruthId) {
        throw new ShotPlanValidationError(
          'Shot Plan truth_revision_id must match the currently approved Truth Pack revision',
        );
      }

      const briefs = await tx.shotBrief.findMany({
        where: { workspaceId, shotPlanRevisionId: revisionId },
        orderBy: { orderIndex: 'asc' },
      });
      const gate = canApproveShotPlanRevision({
        hasApprovedTruthRevision: true,
        revisionStatus: lockedRev.status,
        briefs: briefs.map((b) => ({ slot: b.slot })),
      });
      if (!gate.ok) {
        throw new ShotPlanValidationError(gate.reason);
      }

      const revUpdate = await tx.shotPlanRevision.updateMany({
        where: {
          id: revisionId,
          workspaceId,
          documentId: lockedDoc.id,
          status: 'PENDING_REVIEW',
        },
        data: {
          status: 'APPROVED' satisfies ShotPlanRevisionStatus,
          approvedByUserId,
          approvedAt: new Date(),
        },
      });
      if (revUpdate.count !== 1) {
        throw new ShotPlanConflictError(
          'Approve conflict: Shot Plan revision conditional update affected 0 rows',
        );
      }

      const docUpdate = await tx.shotPlanDocument.updateMany({
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
        throw new ShotPlanConflictError(
          'Approve conflict: Shot Plan document conditional update affected 0 rows (not current)',
        );
      }

      await tx.auditEvent.create({
        data: {
          id: newId(),
          workspaceId,
          actorUserId: approvedByUserId,
          action: 'shot_plan.approved',
          subjectType: 'shot_plan_revision',
          subjectId: revisionId,
          metadataJson: {
            projectId,
            documentId: lockedDoc.id,
            truthRevisionId: lockedRev.truth_revision_id,
            briefCount: briefs.length,
          },
        },
      });

      return tx.shotPlanRevision.findFirstOrThrow({
        where: { id: revisionId, workspaceId },
        include: { briefs: { orderBy: { orderIndex: 'asc' } } },
      });
    });
  }
}
