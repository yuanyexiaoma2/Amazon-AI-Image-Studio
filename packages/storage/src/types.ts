export type PutObjectInput = {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
};

export type SignedUrlInput = {
  key: string;
  expiresInSeconds?: number;
};

/** S3/MinIO adapter port — stub for W1. */
export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<{ key: string; etag: string }>;
  getSignedUrl(input: SignedUrlInput): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
