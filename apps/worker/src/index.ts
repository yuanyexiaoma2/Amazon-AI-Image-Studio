import { Queue, Worker } from 'bullmq';
import { createLogger } from '@studio/config';
import { handleHealthJob, type HealthJobData } from './jobs/health.js';
import {
  handleInspectJob,
  relayPendingInspectOutbox,
  connectionFromUrl,
} from './jobs/inspect-asset.js';
import {
  handleGenerationAttemptJob,
  relayPendingGenerationOutbox,
  type GenerationAttemptJobData,
} from './jobs/generation-attempt.js';
import type { InspectInput } from '@studio/imaging';

const log = createLogger({ name: 'worker' });
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = connectionFromUrl(redisUrl);
export const HEALTH_QUEUE = 'health';
export const INSPECT_QUEUE = 'asset-inspect';
export const GENERATION_QUEUE = 'generation-attempt';

async function main() {
  const healthQueue = new Queue<HealthJobData>(HEALTH_QUEUE, { connection });
  const healthWorker = new Worker<HealthJobData>(HEALTH_QUEUE, handleHealthJob, { connection });

  const inspectQueue = new Queue<InspectInput>(INSPECT_QUEUE, { connection });
  const inspectWorker = new Worker<InspectInput>(
    INSPECT_QUEUE,
    async (job) => handleInspectJob(job.data),
    { connection },
  );

  const generationQueue = new Queue<GenerationAttemptJobData>(GENERATION_QUEUE, { connection });
  const generationWorker = new Worker<GenerationAttemptJobData>(
    GENERATION_QUEUE,
    async (job) => handleGenerationAttemptJob(job.data),
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
  generationWorker.on('completed', (job, result) => {
    log.info({ jobId: job.id, result }, 'generation job completed');
  });
  generationWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'generation job failed');
  });

  await healthQueue.add('startup-health', { ping: 'startup' }, { removeOnComplete: 100 });

  const recoveredInspect = await relayPendingInspectOutbox(inspectQueue);
  if (recoveredInspect > 0) {
    log.info({ recovered: recoveredInspect }, 'relayed pending inspect outbox messages');
  }
  const recoveredGen = await relayPendingGenerationOutbox(generationQueue);
  if (recoveredGen > 0) {
    log.info({ recovered: recoveredGen }, 'relayed pending generation outbox messages');
  }

  setInterval(() => {
    void relayPendingInspectOutbox(inspectQueue).then((n) => {
      if (n > 0) log.info({ recovered: n }, 'periodic inspect outbox relay');
    });
    void relayPendingGenerationOutbox(generationQueue).then((n) => {
      if (n > 0) log.info({ recovered: n }, 'periodic generation outbox relay');
    });
  }, 15_000).unref();

  log.info(
    {
      redisUrl: `${connection.host}:${connection.port}`,
      queues: [HEALTH_QUEUE, INSPECT_QUEUE, GENERATION_QUEUE],
    },
    'worker started',
  );
}

main().catch((err) => {
  log.error({ err }, 'worker crashed');
  process.exit(1);
});
