import { prisma } from '@studio/db';
import { S3ObjectStorage } from '@studio/storage';
import { inspectUploadedAsset, type InspectInput } from '@studio/imaging';
import { createLogger } from '@studio/config';

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
