export type PutObjectInput = {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
};

export type SignedUrlInput = {
  key: string;
  expiresInSeconds?: number;
};

export type SignedPutUrlInput = {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
  contentLength?: number;
};

/** S3/MinIO adapter port. */
export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<{ key: string; etag: string }>;
  getObject(key: string): Promise<{ body: Buffer; contentType?: string }>;
  headObject(key: string): Promise<{ contentLength: number; contentType?: string } | null>;
  getSignedUrl(input: SignedUrlInput): Promise<string>;
  getSignedPutUrl(input: SignedPutUrlInput): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
