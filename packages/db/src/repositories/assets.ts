import type {
  Asset,
  AssetRepresentation,
  AssetRepresentationKind,
  AssetStatus,
  AssetVersion,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { newId } from '../ids.js';

export type CreateVersionInput = {
  /** Optional predetermined UUIDv7 (presign allocates original key with this id). */
  id?: string;
  workspaceId: string;
  assetId: string;
  versionNumber: number;
  sha256: string;
  mime: string;
  width: number | null;
  height: number | null;
  colorSpace: string | null;
  byteSize: number;
  metadataJson?: Prisma.InputJsonValue;
};

export type CreateRepresentationInput = {
  workspaceId: string;
  assetVersionId: string;
  kind: AssetRepresentationKind;
  storageKey: string;
  sha256: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  contentType: string;
};

export class AssetRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(workspaceId: string, assetId: string): Promise<Asset | null> {
    return this.db.asset.findFirst({
      where: { id: assetId, workspaceId, deletedAt: null },
    });
  }

  async listByProject(workspaceId: string, projectId: string): Promise<Asset[]> {
    return this.db.asset.findMany({
      where: { workspaceId, projectId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setStatus(
    workspaceId: string,
    assetId: string,
    status: AssetStatus,
  ): Promise<Asset> {
    const existing = await this.findById(workspaceId, assetId);
    if (!existing) throw new Error('Asset not found in workspace');
    return this.db.asset.update({
      where: { id: assetId },
      data: { status },
    });
  }

  async createVersion(input: CreateVersionInput): Promise<AssetVersion> {
    return this.db.assetVersion.create({
      data: {
        id: input.id ?? newId(),
        workspaceId: input.workspaceId,
        assetId: input.assetId,
        versionNumber: input.versionNumber,
        sha256: input.sha256,
        mime: input.mime,
        width: input.width,
        height: input.height,
        colorSpace: input.colorSpace,
        byteSize: input.byteSize,
        metadataJson: input.metadataJson ?? {},
      },
    });
  }

  async addRepresentation(
    input: CreateRepresentationInput,
  ): Promise<AssetRepresentation> {
    return this.db.assetRepresentation.create({
      data: {
        id: newId(),
        workspaceId: input.workspaceId,
        assetVersionId: input.assetVersionId,
        kind: input.kind,
        storageKey: input.storageKey,
        sha256: input.sha256,
        bytes: input.bytes,
        width: input.width ?? null,
        height: input.height ?? null,
        contentType: input.contentType,
      },
    });
  }

  async setCurrentVersion(
    workspaceId: string,
    assetId: string,
    versionId: string,
  ): Promise<Asset> {
    const version = await this.db.assetVersion.findFirst({
      where: { id: versionId, workspaceId, assetId },
    });
    if (!version) throw new Error('Version not found in workspace/asset');
    return this.db.asset.update({
      where: { id: assetId },
      data: { currentVersionId: versionId, status: 'READY' },
    });
  }

  async getVersionWithRepresentations(workspaceId: string, versionId: string) {
    return this.db.assetVersion.findFirst({
      where: { id: versionId, workspaceId },
      include: { representations: true },
    });
  }

  async listVersions(workspaceId: string, assetId: string) {
    return this.db.assetVersion.findMany({
      where: { workspaceId, assetId },
      include: { representations: true },
      orderBy: { versionNumber: 'asc' },
    });
  }

  async nextVersionNumber(workspaceId: string, assetId: string): Promise<number> {
    const agg = await this.db.assetVersion.aggregate({
      where: { workspaceId, assetId },
      _max: { versionNumber: true },
    });
    return (agg._max.versionNumber ?? 0) + 1;
  }

  async softDelete(workspaceId: string, assetId: string): Promise<Asset> {
    const existing = await this.findById(workspaceId, assetId);
    if (!existing) throw new Error('Asset not found in workspace');
    return this.db.asset.update({
      where: { id: assetId },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
  }
}
