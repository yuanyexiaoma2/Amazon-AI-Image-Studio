import { prisma } from '@studio/db';
import { FakeOcrProvider, FakeVisionQaProvider } from '@studio/providers';
import { runQaEvaluation } from '@studio/imaging';
import { ensureStorageReady } from './storage';

export async function runQaEvaluationInline(data: { workspaceId: string; reportId: string }) {
  const storage = await ensureStorageReady();
  await runQaEvaluation({
    db: prisma,
    storage,
    workspaceId: data.workspaceId,
    reportId: data.reportId,
    ocr: new FakeOcrProvider(),
    vision: new FakeVisionQaProvider(),
  });
}
