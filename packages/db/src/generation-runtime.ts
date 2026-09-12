/**
 * Shared generation runtime helpers (W5-A): asset ingest + orphan webhook reconcile.
 * Used by apps/web (GENERATION_INLINE) and apps/worker.
 */

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { buildAssetObjectKey } from '@studio/domain';
import { AssetRepository } from './repositories/assets.js';
import { NodeResultRepository } from './repositories/node-results.js';
import { newId } from './ids.js';

export type ProviderOutputBytes = {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
  role?: 'image' | 'mask';
};

export async function ingestProviderOutputs(input: {
  db: PrismaClient;
  storage: {
    putObject(args: {
      key: string;
      body: Buffer;
      contentType: string;
    }): Promise<unknown>;
  };
  workspaceId: string;
  projectId: string;
  createdByUserId: string;
  attemptId: string;
  nodeType: string;
  workflowRevisionId: string;
  nodeId: string;
  inputFingerprint: string | null;
  parentAssetVersionId?: string | null;
  outputs: ProviderOutputBytes[];
}): Promise<{
  imageVersionIds: string[];
  maskVersionId: string | null;
}> {
  const assets = new AssetRepository(input.db);
  const nodeResults = new NodeResultRepository(input.db);
  const imageVersionIds: string[] = [];
  let maskVersionId: string | null = null;

  let imageIndex = 0;
  for (const out of input.outputs) {
    const role =
      out.role ??
      (input.nodeType === 'remove_background' && imageIndex === 1 ? 'mask' : 'image');
    const sha256 = createHash('sha256').update(out.bytes).digest('hex');
    const isMask = role === 'mask';
    const kind = isMask ? ('MASK' as const) : ('GENERATED' as const);
    const assetId = newId();
    const versionId = newId();
    // Pre-allocate ids via createGenerated — it generates its own; use helper then.
    const storageKey = buildAssetObjectKey({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      assetId, // placeholder — helper creates new ids; rebuild after
      kind: isMask ? 'masks' : 'original',
      versionId,
      ext: out.mimeType === 'image/jpeg' ? 'jpg' : 'png',
    });
    void storageKey;
    void assetId;
    void versionId;

    const created = await assets.createGeneratedAssetWithVersion({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      createdByUserId: input.createdByUserId,
      kind,
      originalFilename: isMask
        ? `mask-${input.nodeId}.png`
        : `gen-${input.nodeId}-${imageIndex}.png`,
      sha256,
      mime: out.mimeType,
      width: out.width,
      height: out.height,
      byteSize: out.bytes.length,
      storageKey: 'pending',
      representationKind: isMask ? 'MASK_PNG' : 'ORIGINAL_UPLOAD',
      metadataJson: {
        attemptId: input.attemptId,
        nodeId: input.nodeId,
        role,
      },
      primaryParentVersionId: input.parentAssetVersionId ?? null,
    });

    const key = buildAssetObjectKey({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      assetId: created.asset.id,
      kind: isMask ? 'masks' : 'original',
      versionId: created.version.id,
      ext: out.mimeType === 'image/jpeg' ? 'jpg' : 'png',
    });
    await input.storage.putObject({
      key,
      body: out.bytes,
      contentType: out.mimeType,
    });
    await input.db.assetRepresentation.update({
      where: { id: created.representation.id },
      data: { storageKey: key },
    });

    if (isMask) {
      maskVersionId = created.version.id;
      // Link Mask row to parent image version when available
      if (input.parentAssetVersionId) {
        await input.db.mask.create({
          data: {
            id: newId(),
            workspaceId: input.workspaceId,
            assetVersionId: input.parentAssetVersionId,
            strokesJson: [],
            coordinateSpace: 'full_resolution_raster',
            metadataJson: {
              maskAssetVersionId: created.version.id,
              source: 'remove_background',
              width: out.width,
              height: out.height,
            },
          },
        });
      }
    } else {
      imageVersionIds.push(created.version.id);
      imageIndex += 1;
    }
  }

  await nodeResults.upsert({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workflowRevisionId: input.workflowRevisionId,
    nodeId: input.nodeId,
    status: 'SUCCEEDED',
    inputFingerprint: input.inputFingerprint,
    staleReason: null,
    staleCause: null,
    outputJson: {
      imageAssetVersionIds: imageVersionIds,
      maskAssetVersionId: maskVersionId,
    },
    lastAttemptId: input.attemptId,
  });

  return { imageVersionIds, maskVersionId };
}

/**
 * Apply orphan provider_events (processedAt IS NULL) for a known externalJobId.
 * Sets processedAt only after successful apply.
 */
export async function reconcileOrphanProviderEvents(
  db: PrismaClient,
  provider: string,
  externalJobId: string,
): Promise<{ applied: number }> {
  const orphans = await db.providerEvent.findMany({
    where: {
      provider,
      externalJobId,
      processedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (orphans.length === 0) return { applied: 0 };

  const submission = await db.providerSubmission.findFirst({
    where: { provider, externalJobId },
    include: { attempt: { include: { item: { include: { run: true } } } } },
  });
  if (!submission) return { applied: 0 };

  let applied = 0;
  for (const ev of orphans) {
    const raw = ev.payloadJson as { status?: string };
    const status = raw?.status ?? 'RUNNING';
    await db.providerSubmission.update({
      where: { id: submission.id },
      data: {
        status:
          status === 'SUCCEEDED'
            ? 'SUCCEEDED'
            : status === 'FAILED'
              ? 'FAILED'
              : status === 'CANCELED'
                ? 'CANCELED'
                : 'RUNNING',
        heartbeatAt: new Date(),
      },
    });
    await db.progressEvent.create({
      data: {
        id: newId(),
        workspaceId: submission.workspaceId,
        projectId: submission.attempt.item.run.projectId,
        runId: submission.attempt.item.runId,
        attemptId: submission.attemptId,
        type: 'provider.webhook.reconcile',
        payloadJson: {
          providerEventId: ev.externalEventId,
          externalJobId,
          status,
          orphan: true,
        },
      },
    });
    await db.providerEvent.update({
      where: { id: ev.id },
      data: { processedAt: new Date(), workspaceId: submission.workspaceId },
    });
    applied += 1;
  }
  return { applied };
}
