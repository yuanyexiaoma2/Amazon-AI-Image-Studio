import type {
  Asset,
  OutboxMessage,
  Prisma,
  PrismaClient,
  UploadSession,
  UploadSessionStatus,
} from '@prisma/client';
import { newId } from '../ids.js';
import { inspectJobId } from './outbox.js';

export type CreatePresignInput = {
  workspaceId: string;
  projectId: string;
  createdByUserId: string;
  expectedKey: string;
  expectedMime: string;
  expectedBytes: number;
  originalFilename: string;
  expiresAt: Date;
};

export type MarkInspectingWithOutboxInput = {
  workspaceId: string;
  uploadId: string;
  assetId: string;
  projectId: string;
  expectedKey: string;
  expectedMime: string;
  expectedBytes: number;
  completionKey?: string;
  expectedChecksumSha256?: string;
};

/**
 * Tenant-scoped upload sessions. Asset stub is created with the session at presign time.
 */
export class UploadRepository {
  constructor(private readonly db: PrismaClient) {}

  async createPresignSession(
    input: CreatePresignInput,
  ): Promise<{ session: UploadSession; asset: Asset }> {
    const assetId = newId();
    const sessionId = newId();

    return this.db.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          id: assetId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          kind: 'PRODUCT_PHOTO',
          status: 'UPLOADING',
          originalFilename: input.originalFilename,
          createdByUserId: input.createdByUserId,
        },
      });

      const session = await tx.uploadSession.create({
        data: {
          id: sessionId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          assetId,
          expectedKey: input.expectedKey,
          expectedMime: input.expectedMime,
          expectedBytes: input.expectedBytes,
          status: 'CREATED',
          expiresAt: input.expiresAt,
          createdByUserId: input.createdByUserId,
        },
      });

      return { session, asset };
    });
  }

  async findSession(
    workspaceId: string,
    uploadId: string,
  ): Promise<UploadSession | null> {
    return this.db.uploadSession.findFirst({
      where: { id: uploadId, workspaceId },
    });
  }

  async findByCompletionKey(
    workspaceId: string,
    completionKey: string,
  ): Promise<UploadSession | null> {
    return this.db.uploadSession.findFirst({
      where: { workspaceId, completionKey },
    });
  }

  async markStatus(
    workspaceId: string,
    uploadId: string,
    status: UploadSessionStatus,
    extra: {
      completionKey?: string;
      expectedChecksumSha256?: string;
      rejectionReason?: string;
    } = {},
  ): Promise<UploadSession> {
    const result = await this.db.uploadSession.updateMany({
      where: { id: uploadId, workspaceId },
      data: {
        status,
        ...(extra.completionKey != null ? { completionKey: extra.completionKey } : {}),
        ...(extra.expectedChecksumSha256 != null
          ? { expectedChecksumSha256: extra.expectedChecksumSha256 }
          : {}),
        ...(extra.rejectionReason != null
          ? { rejectionReason: extra.rejectionReason }
          : {}),
      },
    });
    if (result.count === 0) throw new Error('Upload session not found in workspace');
    return this.findSession(workspaceId, uploadId) as Promise<UploadSession>;
  }

  /**
   * Atomically: UPLOADED→INSPECTING + asset PROCESSING + outbox PENDING row.
   * Caller must publish/relay the returned outbox message with stable jobId.
   */
  async markInspectingWithOutbox(
    input: MarkInspectingWithOutboxInput,
  ): Promise<{ session: UploadSession; outbox: OutboxMessage }> {
    const jobId = inspectJobId(input.uploadId);
    const payload: Prisma.InputJsonValue = {
      workspaceId: input.workspaceId,
      uploadId: input.uploadId,
      assetId: input.assetId,
      projectId: input.projectId,
      expectedKey: input.expectedKey,
      expectedMime: input.expectedMime,
      expectedBytes: input.expectedBytes,
      expectedChecksumSha256: input.expectedChecksumSha256 ?? null,
    };

    return this.db.$transaction(async (tx) => {
      const updated = await tx.uploadSession.updateMany({
        where: {
          id: input.uploadId,
          workspaceId: input.workspaceId,
          status: { in: ['CREATED', 'UPLOADING', 'UPLOADED'] },
        },
        data: {
          status: 'INSPECTING',
          ...(input.completionKey != null ? { completionKey: input.completionKey } : {}),
          ...(input.expectedChecksumSha256 != null
            ? { expectedChecksumSha256: input.expectedChecksumSha256 }
            : {}),
        },
      });
      if (updated.count === 0) {
        const existing = await tx.uploadSession.findFirst({
          where: { id: input.uploadId, workspaceId: input.workspaceId },
        });
        if (!existing) throw new Error('Upload session not found in workspace');
        // Already inspecting/ready — still ensure outbox exists for recovery
        const existingOutbox = await tx.outboxMessage.findUnique({ where: { jobId } });
        if (existingOutbox) {
          return { session: existing, outbox: existingOutbox };
        }
      }

      await tx.asset.updateMany({
        where: { id: input.assetId, workspaceId: input.workspaceId },
        data: { status: 'PROCESSING' },
      });

      const outbox =
        (await tx.outboxMessage.findUnique({ where: { jobId } })) ??
        (await tx.outboxMessage.create({
          data: {
            id: newId(),
            workspaceId: input.workspaceId,
            aggregateType: 'UploadSession',
            aggregateId: input.uploadId,
            jobName: 'inspect',
            jobId,
            payload,
            status: 'PENDING',
            attempts: 0,
          },
        }));

      const session = await tx.uploadSession.findFirstOrThrow({
        where: { id: input.uploadId, workspaceId: input.workspaceId },
      });
      return { session, outbox };
    });
  }
}
