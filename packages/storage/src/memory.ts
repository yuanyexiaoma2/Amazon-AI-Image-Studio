import type { ObjectStorage, PutObjectInput, SignedUrlInput } from './types.js';

/** In-memory storage stub for unit tests / local without MinIO. */
export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async putObject(input: PutObjectInput) {
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
    });
    return { key: input.key, etag: `"${input.key.length}"` };
  }

  async getSignedUrl(input: SignedUrlInput) {
    if (!this.objects.has(input.key)) {
      throw new Error(`Object not found: ${input.key}`);
    }
    return `memory://signed/${input.key}?exp=${input.expiresInSeconds ?? 3600}`;
  }

  async deleteObject(key: string) {
    this.objects.delete(key);
  }

  has(key: string) {
    return this.objects.has(key);
  }
}
