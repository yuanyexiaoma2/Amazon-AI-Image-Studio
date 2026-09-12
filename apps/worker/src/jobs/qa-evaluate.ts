import { prisma, OutboxRepository } from '@studio/db';
import { FakeOcrProvider, FakeVisionQaProvider } from '@studio/providers';
import { runQaEvaluation } from '@studio/imaging';
import { S3ObjectStorage } from '@studio/storage';

export type QaEvaluateJobData = { workspaceId: string; reportId: string };

function storage() {
  return S3ObjectStorage.fromEnv(process.env);
}

export async function handleQaEvaluateJob(data: QaEvaluateJobData): Promise<{ ok: true }> {
  const s = storage();
  await s.ensureBucket();
  await runQaEvaluation({
    db: prisma,
    storage: s,
    workspaceId: data.workspaceId,
    reportId: data.reportId,
    ocr: new FakeOcrProvider(),
    vision: new FakeVisionQaProvider(),
  });
  return { ok: true };
}

export async function relayPendingQaOutbox(queue: {
  add: (name: string, data: QaEvaluateJobData, opts: { jobId: string }) => Promise<unknown>;
}): Promise<number> {
  const repo = new OutboxRepository(prisma);
  const pending = await repo.listPending(50);
  let n = 0;
  for (const row of pending) {
    if (!row.jobId.startsWith('qa-evaluate-')) continue;
    try {
      await queue.add('qa-evaluate', row.payload as QaEvaluateJobData, { jobId: row.jobId });
      await repo.markPublished(row.workspaceId, row.id);
      n += 1;
    } catch {
      // leave for next pass
    }
  }
  return n;
}
