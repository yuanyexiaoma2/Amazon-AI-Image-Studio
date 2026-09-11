import { Queue } from 'bullmq';
import { prisma } from '@studio/db';
import { inspectUploadedAsset, type InspectInput } from '@studio/imaging';
import { ensureStorageReady } from './storage';

export const INSPECT_QUEUE = 'asset-inspect';
export const TRUTH_EXTRACT_QUEUE = 'truth-extract';

export type InspectJobData = InspectInput;
export type TruthExtractJobData = {
  workspaceId: string;
  projectId: string;
  revisionHint?: string;
  assetVersionIds: string[];
  createdByUserId: string;
};

function connectionFromUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    maxRetriesPerRequest: null as null,
  };
}

let inspectQueue: Queue<InspectJobData> | null = null;

export function getInspectQueue(): Queue<InspectJobData> {
  if (!inspectQueue) {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    inspectQueue = new Queue<InspectJobData>(INSPECT_QUEUE, {
      connection: connectionFromUrl(redisUrl),
    });
  }
  return inspectQueue;
}

/** When INSPECT_INLINE=1 (CI/e2e), run inspect in-process; otherwise enqueue BullMQ job. */
export async function enqueueInspect(data: InspectJobData): Promise<void> {
  if (process.env.INSPECT_INLINE === '1' || process.env.INSPECT_INLINE === 'true') {
    const storage = await ensureStorageReady();
    await inspectUploadedAsset({ db: prisma, storage, input: data });
    return;
  }
  await getInspectQueue().add('inspect', data, {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}
