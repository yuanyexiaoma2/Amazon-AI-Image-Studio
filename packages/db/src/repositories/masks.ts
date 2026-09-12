import type { Mask, Prisma, PrismaClient } from '@prisma/client';
import { newId } from '../ids.js';

export type UpsertMaskInput = {
  workspaceId: string;
  assetVersionId: string;
  /** Update existing when set. */
  maskId?: string;
  strokesJson: Prisma.InputJsonValue;
  coordinateSpace?: string;
  metadataJson?: Prisma.InputJsonValue;
};

export class MaskRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(workspaceId: string, maskId: string): Promise<Mask | null> {
    return this.db.mask.findFirst({
      where: { id: maskId, workspaceId, deletedAt: null },
    });
  }

  async listForAssetVersion(workspaceId: string, assetVersionId: string): Promise<Mask[]> {
    return this.db.mask.findMany({
      where: { workspaceId, assetVersionId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(input: UpsertMaskInput): Promise<Mask> {
    return this.db.mask.create({
      data: {
        id: newId(),
        workspaceId: input.workspaceId,
        assetVersionId: input.assetVersionId,
        strokesJson: input.strokesJson,
        coordinateSpace: input.coordinateSpace ?? 'normalized_0_1',
        metadataJson: input.metadataJson ?? {},
      },
    });
  }

  async update(
    workspaceId: string,
    maskId: string,
    data: {
      strokesJson?: Prisma.InputJsonValue;
      coordinateSpace?: string;
      metadataJson?: Prisma.InputJsonValue;
    },
  ): Promise<Mask | null> {
    const existing = await this.findById(workspaceId, maskId);
    if (!existing) return null;
    return this.db.mask.update({
      where: { id: maskId },
      data: {
        ...(data.strokesJson !== undefined ? { strokesJson: data.strokesJson } : {}),
        ...(data.coordinateSpace !== undefined ? { coordinateSpace: data.coordinateSpace } : {}),
        ...(data.metadataJson !== undefined ? { metadataJson: data.metadataJson } : {}),
      },
    });
  }

  async softDelete(workspaceId: string, maskId: string): Promise<boolean> {
    const result = await this.db.mask.updateMany({
      where: { id: maskId, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }
}
