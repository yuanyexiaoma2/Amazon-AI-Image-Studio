import { Queue } from 'bullmq';
import {
  decideQueueAdmission,
  resolveQueueMaxWaiting,
  resolveWorkerConcurrency,
} from '@studio/domain';
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
    const queue = getGenerationQueue();
    const waiting = await queue.getWaitingCount();
    const concurrency = resolveWorkerConcurrency(process.env);
    const maxWaiting = resolveQueueMaxWaiting(process.env);
    const decision = decideQueueAdmission({ waiting, concurrency, maxWaiting });
    if (!decision.admit) {
      const msg = `QUEUE_BACKPRESSURE waiting=${waiting} max=${maxWaiting}`;
      await outboxRepo.bumpAttempt(outbox.workspaceId, outbox.id, msg);
      throw new Error(msg);
    }
    await queue.add('generation-attempt', data, {
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
    if (!/QUEUE_BACKPRESSURE/.test(msg)) {
      await outboxRepo.bumpAttempt(outbox.workspaceId, outbox.id, msg);
    }
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

export const QA_QUEUE = 'qa-evaluate';
export const EXPORT_QUEUE = 'export-bundle';

export type QaEvaluateJobData = { workspaceId: string; reportId: string };
export type ExportBundleJobData = { workspaceId: string; bundleId: string };

function inlineQa(): boolean {
  return (
    process.env.QA_INLINE === '1' ||
    process.env.QA_INLINE === 'true' ||
    process.env.INSPECT_INLINE === '1' ||
    process.env.INSPECT_INLINE === 'true'
  );
}

function inlineExport(): boolean {
  return (
    process.env.EXPORT_INLINE === '1' ||
    process.env.EXPORT_INLINE === 'true' ||
    process.env.INSPECT_INLINE === '1' ||
    process.env.INSPECT_INLINE === 'true'
  );
}

let qaQueue: Queue<QaEvaluateJobData> | null = null;
let exportQueue: Queue<ExportBundleJobData> | null = null;

export function getQaQueue(): Queue<QaEvaluateJobData> {
  if (!qaQueue) {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    qaQueue = new Queue<QaEvaluateJobData>(QA_QUEUE, { connection: connectionFromUrl(redisUrl) });
  }
  return qaQueue;
}

export function getExportQueue(): Queue<ExportBundleJobData> {
  if (!exportQueue) {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    exportQueue = new Queue<ExportBundleJobData>(EXPORT_QUEUE, {
      connection: connectionFromUrl(redisUrl),
    });
  }
  return exportQueue;
}

export async function publishQaOutbox(outbox: {
  id: string;
  workspaceId: string;
  jobId: string;
  payload: unknown;
}): Promise<void> {
  const outboxRepo = new OutboxRepository(prisma);
  const data = outbox.payload as QaEvaluateJobData;
  if (inlineQa()) {
    const { runQaEvaluationInline } = await import('./run-qa-inline');
    await runQaEvaluationInline(data);
    await outboxRepo.markPublished(outbox.workspaceId, outbox.id);
    return;
  }
  try {
    await getQaQueue().add('qa-evaluate', data, {
      jobId: outbox.jobId,
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
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

export async function enqueueQaFromOutbox(outbox: {
  id: string;
  workspaceId: string;
  jobId: string;
  payload: unknown;
}): Promise<{ published: boolean }> {
  try {
    await publishQaOutbox(outbox);
    return { published: true };
  } catch {
    return { published: false };
  }
}

export async function publishExportOutbox(outbox: {
  id: string;
  workspaceId: string;
  jobId: string;
  payload: unknown;
}): Promise<void> {
  const outboxRepo = new OutboxRepository(prisma);
  const data = outbox.payload as ExportBundleJobData;
  if (inlineExport()) {
    const { runExportBundleInline } = await import('./run-export-inline');
    await runExportBundleInline(data);
    await outboxRepo.markPublished(outbox.workspaceId, outbox.id);
    return;
  }
  try {
    await getExportQueue().add('export-bundle', data, {
      jobId: outbox.jobId,
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
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

export async function enqueueExportFromOutbox(outbox: {
  id: string;
  workspaceId: string;
  jobId: string;
  payload: unknown;
}): Promise<{ published: boolean }> {
  try {
    await publishExportOutbox(outbox);
    return { published: true };
  } catch {
    return { published: false };
  }
}
