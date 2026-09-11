import type { Job } from 'bullmq';

export type HealthJobData = { ping?: string };

export async function handleHealthJob(job: Job<HealthJobData>) {
  return {
    ok: true,
    ping: job.data.ping ?? 'pong',
    at: new Date().toISOString(),
    jobId: job.id,
  };
}
