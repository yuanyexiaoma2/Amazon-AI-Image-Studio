import { prisma } from '@studio/db';
import { runExportBundle } from '@studio/imaging';
import { ensureStorageReady } from './storage';

export async function runExportBundleInline(data: { workspaceId: string; bundleId: string }) {
  const storage = await ensureStorageReady();
  await runExportBundle({
    db: prisma,
    storage,
    workspaceId: data.workspaceId,
    bundleId: data.bundleId,
  });
}
