import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ObjectStorage,
  PutObjectInput,
  SignedPutUrlInput,
  SignedUrlInput,
} from './types.js';

export type S3ObjectStorageOptions = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
};

/** S3 / MinIO ObjectStorage adapter for CI and local infra. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly options: S3ObjectStorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): S3ObjectStorage {
    return new S3ObjectStorage({
      endpoint: env.S3_ENDPOINT ?? 'http://localhost:9000',
      region: env.S3_REGION ?? 'us-east-1',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? 'minioadmin',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
      bucket: env.S3_BUCKET ?? 'studio-assets',
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async putObject(input: PutObjectInput) {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return { key: input.key, etag: result.ETag ?? `"${input.key}"` };
  }

  async getObject(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty body for key ${key}`);
    return {
      body: Buffer.from(bytes),
      contentType: result.ContentType,
    };
  }

  /** @deprecated use getObject */
  async getObjectBody(key: string): Promise<Buffer> {
    const { body } = await this.getObject(key);
    return body;
  }

  async headObject(key: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentLength: result.ContentLength ?? 0,
        contentType: result.ContentType,
      };
    } catch {
      return null;
    }
  }

  async getSignedUrl(input: SignedUrlInput) {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: input.key });
    return getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds ?? 3600,
    });
  }

  async getSignedPutUrl(input: SignedPutUrlInput) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ...(input.contentLength != null ? { ContentLength: input.contentLength } : {}),
    });
    return getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds ?? 900,
    });
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
