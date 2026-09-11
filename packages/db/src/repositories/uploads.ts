import type {
  Asset,
  PrismaClient,
  UploadSession,
  UploadSessionStatus,
} from '@prisma/client';
import { newId } from '../ids.js';

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

  async findByCompletionKey(completionKey: string): Promise<UploadSession | null> {
    return this.db.uploadSession.findUnique({ where: { completionKey } });
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
    return this.db.uploadSession.update({
      where: { id: uploadId },
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
  }
}
