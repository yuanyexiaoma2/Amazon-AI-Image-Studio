import type { GenerationAttemptJobData } from './queues';
import { handleGenerationAttemptJob } from './generation-attempt-handler';

export async function runGenerationAttemptInline(data: GenerationAttemptJobData) {
  return handleGenerationAttemptJob(data);
}
