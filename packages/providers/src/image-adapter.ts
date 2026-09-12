/**
 * ImageProviderAdapter — spec §9.1.
 * Primary image gateway port for W4+.
 */

import type { ImageOperation, ProviderErrorClass } from '@studio/domain';

export type { ImageOperation, ProviderErrorClass };

export type ModelCapabilities = {
  modelId: string;
  operations: ImageOperation[];
  ratios: string[];
  resolutionTiers: string[];
  maxReferenceImages: number;
  maxOutputs: number;
  supportsSeed: boolean;
  supportsWebhook: boolean;
};

export type NormalizedImageRequest = {
  operation: ImageOperation;
  prompt: string;
  negativePrompt?: string;
  referenceAssets?: Array<{ url?: string; providerFileId?: string }>;
  maskAsset?: { url?: string; providerFileId?: string };
  width?: number;
  height?: number;
  aspectRatio?: string;
  resolutionTier?: string;
  count?: number;
  seed?: number;
  strength?: number;
  callbackUrl?: string;
  /** Internal idempotency / submission key. */
  idempotencyKey: string;
  /** Machine-readable truth constraints summary. */
  truthConstraintsSummary?: Record<string, unknown>;
  modelId: string;
  /**
   * Fake / test scenario selector (W4-06).
   * Also accepted via prompt prefix `__SCENARIO:<NAME>__`.
   */
  scenario?: FakeScenario;
  /** Optional client metadata (never sent to real providers verbatim). */
  clientMetadata?: Record<string, unknown>;
};

export type FakeScenario =
  | 'SUCCESS'
  | 'DELAYED_SUCCESS'
  | 'RATE_LIMIT_THEN_SUCCESS'
  | 'AUTH'
  | 'VALIDATION'
  | 'POLICY'
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'TIMEOUT'
  | 'QUOTA'
  | 'UNKNOWN'
  | 'CORRUPT_OUTPUT'
  | 'WEBHOOK_FIRST'
  | 'LATE_AFTER_CANCEL'
  | 'COST_MISMATCH';

export type ProviderSubmission = {
  externalJobId: string;
  submissionKey: string;
  status: 'ACCEPTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  estimatedCostMicrounits?: number;
};

export type ProviderJobStatus = {
  externalJobId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress?: number;
  outputs?: Array<{ url?: string; bytesBase64?: string; mimeType: string; width: number; height: number }>;
  errorClass?: ProviderErrorClass;
  errorMessage?: string;
  actualCostMicrounits?: number;
};

export type CancelResult = { canceled: boolean; lateResultPossible: boolean };

export type VerifiedProviderEvent = {
  providerEventId: string;
  externalJobId: string;
  status: ProviderJobStatus['status'];
  payloadHash: string;
  raw: unknown;
};

export type NormalizedProviderError = {
  errorClass: ProviderErrorClass;
  message: string;
  retryable: boolean;
  httpStatus?: number;
};

export type MoneyEstimate = {
  currency: string;
  estimatedMicrounits: number;
  unitCount: number;
};

export interface ImageProviderAdapter {
  readonly providerKey: string;
  getCapabilities(modelId: string): Promise<ModelCapabilities>;
  submit(request: NormalizedImageRequest): Promise<ProviderSubmission>;
  recoverSubmission?(
    submissionKey: string,
  ): Promise<ProviderSubmission | 'NOT_FOUND' | 'UNKNOWN'>;
  getStatus(externalJobId: string): Promise<ProviderJobStatus>;
  cancel?(externalJobId: string): Promise<CancelResult>;
  verifyWebhook?(
    headers: Headers,
    rawBody: Uint8Array,
  ): Promise<VerifiedProviderEvent>;
  normalizeError(error: unknown): NormalizedProviderError;
  estimateCost(request: NormalizedImageRequest): Promise<MoneyEstimate>;
}

export class ProviderAdapterError extends Error {
  constructor(
    public readonly errorClass: ProviderErrorClass,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ProviderAdapterError';
  }
}
