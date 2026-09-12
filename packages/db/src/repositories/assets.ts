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
    const result = await this.db.asset.updateMany({
      where: { id: assetId, workspaceId },
      data: { status },
    });
    if (result.count === 0) {
      throw new Error('Asset not found in workspace');
    }
    return this.findById(workspaceId, assetId) as Promise<Asset>;
  }

  /**
   * Idempotent version create: if id already exists for this workspace/asset, return it.
   * Unique (workspaceId, assetId, versionNumber) also prevents duplicates.
   */
  async createVersion(input: CreateVersionInput): Promise<AssetVersion> {
    const id = input.id ?? newId();
    if (input.id) {
      const existing = await this.db.assetVersion.findFirst({
        where: { id: input.id, workspaceId: input.workspaceId, assetId: input.assetId },
      });
      if (existing) return existing;
    }
    const byNumber = await this.db.assetVersion.findFirst({
      where: {
        workspaceId: input.workspaceId,
        assetId: input.assetId,
        versionNumber: input.versionNumber,
      },
    });
    if (byNumber) return byNumber;

    try {
      return await this.db.assetVersion.create({
        data: {
          id,
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
    } catch (err) {
      // Concurrent insert — re-read
      const raced = await this.db.assetVersion.findFirst({
        where: {
          workspaceId: input.workspaceId,
          assetId: input.assetId,
          OR: [{ id }, { versionNumber: input.versionNumber }],
        },
      });
      if (raced) return raced;
      throw err;
    }
  }

  /** Idempotent: one representation per (workspace, version, kind). */
  async addRepresentation(
    input: CreateRepresentationInput,
  ): Promise<AssetRepresentation> {
    const existing = await this.db.assetRepresentation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        assetVersionId: input.assetVersionId,
        kind: input.kind,
      },
    });
    if (existing) return existing;

    try {
      return await this.db.assetRepresentation.create({
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
    } catch (err) {
      const raced = await this.db.assetRepresentation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          assetVersionId: input.assetVersionId,
          kind: input.kind,
        },
      });
      if (raced) return raced;
      throw err;
    }
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
    const result = await this.db.asset.updateMany({
      where: { id: assetId, workspaceId },
      data: { currentVersionId: versionId, status: 'READY' },
    });
    if (result.count === 0) throw new Error('Asset not found in workspace');
    return this.findById(workspaceId, assetId) as Promise<Asset>;
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

  /** Prefer version 1 for first inspect; if already present return that number. */
  async resolveInspectVersionNumber(workspaceId: string, assetId: string): Promise<number> {
    const existing = await this.db.assetVersion.findFirst({
      where: { workspaceId, assetId },
      orderBy: { versionNumber: 'asc' },
    });
    if (existing) return existing.versionNumber;
    return 1;
  }

  async softDelete(workspaceId: string, assetId: string): Promise<Asset> {
    const result = await this.db.asset.updateMany({
      where: { id: assetId, workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
    if (result.count === 0) throw new Error('Asset not found in workspace');
    return this.db.asset.findFirstOrThrow({ where: { id: assetId, workspaceId } });
  }

  async assertVersionsInProject(
    workspaceId: string,
    projectId: string,
    versionIds: string[],
  ): Promise<void> {
    if (versionIds.length === 0) return;
    const unique = [...new Set(versionIds)];
    const rows = await this.db.assetVersion.findMany({
      where: {
        workspaceId,
        id: { in: unique },
        asset: { workspaceId, projectId, deletedAt: null },
      },
      select: { id: true },
    });
    if (rows.length !== unique.length) {
      throw new Error('Evidence Asset Version not in current project/workspace');
    }
  }

  /**
   * Create a READY GENERATED/MASK asset with a single version + ORIGINAL_UPLOAD (or MASK_PNG) representation.
   * Used by W5 node executors after Fake/provider success.
   */
  async createGeneratedAssetWithVersion(input: {
    workspaceId: string;
    projectId: string;
    createdByUserId: string;
    kind: 'GENERATED' | 'MASK' | 'REFERENCE';
    originalFilename: string;
    sha256: string;
    mime: string;
    width: number;
    height: number;
    byteSize: number;
    storageKey: string;
    representationKind?: 'ORIGINAL_UPLOAD' | 'MASK_PNG' | 'NORMALIZED_PNG';
    metadataJson?: Prisma.InputJsonValue;
    primaryParentVersionId?: string | null;
  }): Promise<{ asset: Asset; version: AssetVersion; representation: AssetRepresentation }> {
    const assetId = newId();
    const versionId = newId();
    const asset = await this.db.asset.create({
      data: {
        id: assetId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        kind: input.kind,
        status: 'READY',
        originalFilename: input.originalFilename,
        createdByUserId: input.createdByUserId,
      },
    });
    const version = await this.db.assetVersion.create({
      data: {
        id: versionId,
        workspaceId: input.workspaceId,
        assetId,
        versionNumber: 1,
        sha256: input.sha256,
        mime: input.mime,
        width: input.width,
        height: input.height,
        colorSpace: 'sRGB',
        byteSize: input.byteSize,
        metadataJson: input.metadataJson ?? {},
        primaryParentVersionId: input.primaryParentVersionId ?? null,
      },
    });
    const representation = await this.addRepresentation({
      workspaceId: input.workspaceId,
      assetVersionId: versionId,
      kind: input.representationKind ?? (input.kind === 'MASK' ? 'MASK_PNG' : 'ORIGINAL_UPLOAD'),
      storageKey: input.storageKey,
      sha256: input.sha256,
      bytes: input.byteSize,
      width: input.width,
      height: input.height,
      contentType: input.mime,
    });
    await this.setCurrentVersion(input.workspaceId, assetId, versionId);
    const ready = await this.findById(input.workspaceId, assetId);
    return { asset: ready!, version, representation };
  }
}
