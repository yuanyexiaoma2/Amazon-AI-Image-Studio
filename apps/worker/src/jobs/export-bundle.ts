import { prisma, OutboxRepository } from '@studio/db';
import { runExportBundle } from '@studio/imaging';
import { S3ObjectStorage } from '@studio/storage';

export type ExportBundleJobData = { workspaceId: string; bundleId: string };

function storage() {
  return S3ObjectStorage.fromEnv(process.env);
}

export async function handleExportBundleJob(data: ExportBundleJobData): Promise<{ ok: true }> {
  const s = storage();
  await s.ensureBucket();
  await runExportBundle({
    db: prisma,
    storage: s,
    workspaceId: data.workspaceId,
    bundleId: data.bundleId,
  });
  return { ok: true };
}

export async function relayPendingExportOutbox(queue: {
  add: (name: string, data: ExportBundleJobData, opts: { jobId: string }) => Promise<unknown>;
}): Promise<number> {
  const repo = new OutboxRepository(prisma);
  const pending = await repo.listPending(50);
  let n = 0;
  for (const row of pending) {
    if (!row.jobId.startsWith('export-bundle-')) continue;
    try {
      await queue.add('export-bundle', row.payload as ExportBundleJobData, { jobId: row.jobId });
      await repo.markPublished(row.workspaceId, row.id);
      n += 1;
    } catch {
      // leave
    }
  }
  return n;
}
