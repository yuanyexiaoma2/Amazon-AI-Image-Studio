import { Queue, Worker } from 'bullmq';
import { createLogger } from '@studio/config';
import { handleHealthJob, type HealthJobData } from './jobs/health.js';
import { handleInspectJob } from './jobs/inspect-asset.js';
import type { InspectInput } from '@studio/imaging';

const log = createLogger({ name: 'worker' });
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

function connectionFromUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    maxRetriesPerRequest: null as null,
  };
}

const connection = connectionFromUrl(redisUrl);
export const HEALTH_QUEUE = 'health';
export const INSPECT_QUEUE = 'asset-inspect';

async function main() {
  const healthQueue = new Queue<HealthJobData>(HEALTH_QUEUE, { connection });
  const healthWorker = new Worker<HealthJobData>(HEALTH_QUEUE, handleHealthJob, { connection });

  const inspectWorker = new Worker<InspectInput>(
    INSPECT_QUEUE,
    async (job) => handleInspectJob(job.data),
    { connection },
  );

  healthWorker.on('completed', (job, result) => {
    log.info({ jobId: job.id, result }, 'health job completed');
  });
  healthWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'health job failed');
  });
  inspectWorker.on('completed', (job, result) => {
    log.info({ jobId: job.id, result }, 'inspect job completed');
  });
  inspectWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'inspect job failed');
  });

  await healthQueue.add('startup-health', { ping: 'startup' }, { removeOnComplete: 100 });
  log.info(
    { redisUrl: `${connection.host}:${connection.port}`, queues: [HEALTH_QUEUE, INSPECT_QUEUE] },
    'worker started',
  );
}

main().catch((err) => {
  log.error({ err }, 'worker crashed');
  process.exit(1);
});
