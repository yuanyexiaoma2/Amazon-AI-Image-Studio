import type {
  ObjectStorage,
  PutObjectInput,
  SignedPutUrlInput,
  SignedUrlInput,
} from './types.js';

/** In-memory storage for unit tests / local without MinIO. */
export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async putObject(input: PutObjectInput) {
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
    });
    return { key: input.key, etag: `"${input.key.length}"` };
  }

  async getObject(key: string) {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`Object not found: ${key}`);
    return { body: Buffer.from(obj.body), contentType: obj.contentType };
  }

  async headObject(key: string) {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return { contentLength: obj.body.length, contentType: obj.contentType };
  }

  async getSignedUrl(input: SignedUrlInput) {
    if (!this.objects.has(input.key)) {
      throw new Error(`Object not found: ${input.key}`);
    }
    return `memory://signed/${input.key}?exp=${input.expiresInSeconds ?? 3600}`;
  }

  async getSignedPutUrl(input: SignedPutUrlInput) {
    return `memory://put/${input.key}?ct=${encodeURIComponent(input.contentType)}&exp=${input.expiresInSeconds ?? 900}`;
  }

  async deleteObject(key: string) {
    this.objects.delete(key);
  }

  has(key: string) {
    return this.objects.has(key);
  }
}
