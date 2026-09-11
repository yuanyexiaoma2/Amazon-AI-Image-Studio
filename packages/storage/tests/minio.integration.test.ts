import { describe, expect, it } from 'vitest';
import { S3ObjectStorage } from '../src/s3.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('MinIO / S3 ObjectStorage integration', () => {
  it('puts, gets, and signs an object against MinIO', async () => {
    const storage = S3ObjectStorage.fromEnv();
    await storage.ensureBucket();

    const key = `ci/smoke-${Date.now()}.txt`;
    const body = Buffer.from('minio-smoke-ok');
    const put = await storage.putObject({
      key,
      body,
      contentType: 'text/plain',
    });
    expect(put.key).toBe(key);

    const got = await storage.getObjectBody(key);
    expect(got.toString('utf8')).toBe('minio-smoke-ok');

    const url = await storage.getSignedUrl({ key, expiresInSeconds: 60 });
    expect(url).toMatch(/^https?:\/\//);

    await storage.deleteObject(key);
  });
});
