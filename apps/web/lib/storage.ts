import { S3ObjectStorage } from '@studio/storage';

let singleton: S3ObjectStorage | null = null;

export function getObjectStorage(): S3ObjectStorage {
  if (!singleton) {
    singleton = S3ObjectStorage.fromEnv(process.env);
  }
  return singleton;
}

export async function ensureStorageReady(): Promise<S3ObjectStorage> {
  const storage = getObjectStorage();
  await storage.ensureBucket();
  return storage;
}
