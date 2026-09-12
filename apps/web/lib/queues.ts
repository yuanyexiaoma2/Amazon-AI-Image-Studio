import { Queue } from 'bullmq';
import { prisma, OutboxRepository, inspectJobId, newId } from '@studio/db';
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

/**
 * Publish a single outbox inspect message to BullMQ with stable jobId.
 * Duplicate jobId (already queued/completed) is treated as success.
 */
export async function publishInspectOutbox(outbox: {
  id: string;
  workspaceId: string;
  jobId: string;
  payload: unknown;
}): Promise<void> {
  const outboxRepo = new OutboxRepository(prisma);
  const data = outbox.payload as InspectJobData;

  if (process.env.INSPECT_INLINE === '1' || process.env.INSPECT_INLINE === 'true') {
    const storage = await ensureStorageReady();
    await inspectUploadedAsset({ db: prisma, storage, input: data });
    await outboxRepo.markPublished(outbox.workspaceId, outbox.id);
    return;
  }

  try {
    await getInspectQueue().add('inspect', data, {
      jobId: outbox.jobId,
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
    });
    await outboxRepo.markPublished(outbox.workspaceId, outbox.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // BullMQ rejects duplicate jobId — treat as already published
    if (/job.+already exists|exists/i.test(msg)) {
      await outboxRepo.markPublished(outbox.workspaceId, outbox.id);
      return;
    }
    await outboxRepo.bumpAttempt(outbox.workspaceId, outbox.id, msg);
    throw err;
  }
}

/** Recovery path: publish any PENDING inspect outbox rows. */
export async function relayPendingInspectOutbox(limit = 50): Promise<number> {
  const outboxRepo = new OutboxRepository(prisma);
  const pending = await outboxRepo.listPending(limit);
  let published = 0;
  for (const row of pending) {
    if (!row.jobId.startsWith('inspect-')) continue;
    try {
      await publishInspectOutbox(row);
      published += 1;
    } catch {
      // leave PENDING/FAILED for next recovery pass
    }
  }
  return published;
}

/**
 * After DB transaction wrote outbox: attempt publish; on failure leave PENDING for relay.
 * Never leaves DB at INSPECTING without an outbox row.
 */
export async function enqueueInspectFromOutbox(outbox: {
  id: string;
  workspaceId: string;
  jobId: string;
  payload: unknown;
}): Promise<{ published: boolean }> {
  try {
    await publishInspectOutbox(outbox);
    return { published: true };
  } catch {
    return { published: false };
  }
}

/** @deprecated Prefer markInspectingWithOutbox + enqueueInspectFromOutbox */
export async function enqueueInspect(data: InspectJobData): Promise<void> {
  const jobId = inspectJobId(data.uploadId);
  const existing = await prisma.outboxMessage.findUnique({ where: { jobId } });
  if (existing) {
    await enqueueInspectFromOutbox(existing);
    return;
  }
  const created = await prisma.outboxMessage.create({
    data: {
      id: newId(),
      workspaceId: data.workspaceId,
      aggregateType: 'UploadSession',
      aggregateId: data.uploadId,
      jobName: 'inspect',
      jobId,
      payload: data,
      status: 'PENDING',
    },
  });
  await enqueueInspectFromOutbox(created);
}

export const GENERATION_QUEUE = 'generation-attempt';

export type GenerationAttemptJobData = {
  workspaceId: string;
  projectId: string;
  runId: string;
  itemId: string;
  attemptId: string;
};

let generationQueue: Queue<GenerationAttemptJobData> | null = null;

export function getGenerationQueue(): Queue<GenerationAttemptJobData> {
  if (!generationQueue) {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    generationQueue = new Queue<GenerationAttemptJobData>(GENERATION_QUEUE, {
      connection: connectionFromUrl(redisUrl),
    });
  }
  return generationQueue;
}

export async function publishGenerationOutbox(outbox: {
  id: string;
  workspaceId: string;
  jobId: string;
  payload: unknown;
}): Promise<void> {
  const outboxRepo = new OutboxRepository(prisma);
  const data = outbox.payload as GenerationAttemptJobData;

  if (process.env.GENERATION_INLINE === '1' || process.env.GENERATION_INLINE === 'true') {
    const { runGenerationAttemptInline } = await import('./run-generation-inline');
    await runGenerationAttemptInline(data);
    await outboxRepo.markPublished(outbox.workspaceId, outbox.id);
    return;
  }

  try {
    await getGenerationQueue().add('generation-attempt', data, {
      jobId: outbox.jobId,
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 6,
      backoff: { type: 'exponential', delay: 1000 },
    });
    await outboxRepo.markPublished(outbox.workspaceId, outbox.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/job.+already exists|exists/i.test(msg)) {
      await outboxRepo.markPublished(outbox.workspaceId, outbox.id);
      return;
    }
    await outboxRepo.bumpAttempt(outbox.workspaceId, outbox.id, msg);
    throw err;
  }
}

export async function enqueueGenerationFromOutbox(outbox: {
  id: string;
  workspaceId: string;
  jobId: string;
  payload: unknown;
}): Promise<{ published: boolean }> {
  try {
    await publishGenerationOutbox(outbox);
    return { published: true };
  } catch {
    return { published: false };
  }
}

export async function relayPendingGenerationOutbox(limit = 50): Promise<number> {
  const outboxRepo = new OutboxRepository(prisma);
  const pending = await outboxRepo.listPending(limit);
  let published = 0;
  for (const row of pending) {
    if (!row.jobId.startsWith('gen-attempt-')) continue;
    try {
      await publishGenerationOutbox(row);
      published += 1;
    } catch {
      // leave for recovery
    }
  }
  return published;
}
