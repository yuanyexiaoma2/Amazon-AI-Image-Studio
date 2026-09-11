import { Queue, Worker } from 'bullmq';
import { createLogger } from '@studio/config';
import { handleHealthJob, type HealthJobData } from './jobs/health.js';

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

async function main() {
  const queue = new Queue<HealthJobData>(HEALTH_QUEUE, { connection });
  const worker = new Worker<HealthJobData>(HEALTH_QUEUE, handleHealthJob, { connection });

  worker.on('completed', (job, result) => {
    log.info({ jobId: job.id, result }, 'health job completed');
  });
  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'health job failed');
  });

  // Register a noop/health job on startup so Redis connectivity is exercised.
  await queue.add('startup-health', { ping: 'startup' }, { removeOnComplete: 100 });
  log.info({ redisUrl: `${connection.host}:${connection.port}` }, 'worker started');
}

main().catch((err) => {
  log.error({ err }, 'worker crashed');
  process.exit(1);
});
