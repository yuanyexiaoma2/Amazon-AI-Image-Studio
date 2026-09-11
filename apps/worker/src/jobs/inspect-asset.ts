import { prisma, OutboxRepository } from '@studio/db';
import { S3ObjectStorage } from '@studio/storage';
import { inspectUploadedAsset, type InspectInput } from '@studio/imaging';
import { createLogger } from '@studio/config';
import { Queue } from 'bullmq';

const log = createLogger({ name: 'inspect-asset' });

export async function handleInspectJob(data: InspectInput) {
  const storage = S3ObjectStorage.fromEnv(process.env);
  await storage.ensureBucket();
  const result = await inspectUploadedAsset({ db: prisma, storage, input: data });
  if (!result.ok) {
    log.warn({ reason: result.reason, uploadId: data.uploadId }, 'inspect rejected');
  } else {
    log.info(
      { versionId: result.versionId, uploadId: data.uploadId, sha256: result.sha256 },
      'inspect ready',
    );
  }
  return result;
}

function connectionFromUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    maxRetriesPerRequest: null as null,
  };
}

/** Recovery relay: publish PENDING outbox inspect jobs with stable jobId. */
export async function relayPendingInspectOutbox(
  queue: Queue<InspectInput>,
  limit = 50,
): Promise<number> {
  const outboxRepo = new OutboxRepository(prisma);
  const pending = await outboxRepo.listPending(limit);
  let n = 0;
  for (const row of pending) {
    if (!row.jobId.startsWith('inspect-')) continue;
    const data = row.payload as InspectInput;
    try {
      await queue.add('inspect', data, {
        jobId: row.jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      });
      await outboxRepo.markPublished(row.workspaceId, row.id);
      n += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists|exists/i.test(msg)) {
        await outboxRepo.markPublished(row.workspaceId, row.id);
        n += 1;
        continue;
      }
      await outboxRepo.bumpAttempt(row.workspaceId, row.id, msg);
      log.warn({ jobId: row.jobId, err: msg }, 'outbox relay publish failed');
    }
  }
  return n;
}

export { connectionFromUrl };
