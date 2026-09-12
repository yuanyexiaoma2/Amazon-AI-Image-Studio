import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  FAKE_PRIMARY_MODEL,
  shouldAutoRetry,
  type ProviderErrorClass,
} from '@studio/domain';
import type {
  CancelResult,
  FakeScenario,
  ImageProviderAdapter,
  ModelCapabilities,
  MoneyEstimate,
  NormalizedImageRequest,
  NormalizedProviderError,
  ProviderJobStatus,
  ProviderSubmission,
  VerifiedProviderEvent,
} from './image-adapter.js';
import { ProviderAdapterError } from './image-adapter.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Minimal RGB PNG stamp for Fake MASK bytes; AssetVersion stores full request WxH. */
function makeSolidPngBase64(width: number, height: number, gray: number): string {
  const w = Math.max(1, Math.min(width, 64));
  const h = Math.max(1, Math.min(height, 64));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      raw[i] = gray;
      raw[i + 1] = gray;
      raw[i + 2] = gray;
    }
  }
  const compressed = deflateSync(raw);
  function crc32(buf: Buffer): number {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]!;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }
  function chunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcBuf), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

type InternalJob = {
  externalJobId: string;
  submissionKey: string;
  request: NormalizedImageRequest;
  scenario: FakeScenario;
  status: ProviderJobStatus['status'];
  progress: number;
  rateLimitHits: number;
  createdAt: number;
  canceled: boolean;
  actualCostMicrounits: number;
  estimatedCostMicrounits: number;
};

const jobs = new Map<string, InternalJob>();
const bySubmission = new Map<string, string>();

export function resetFakeProviderState(): void {
  jobs.clear();
  bySubmission.clear();
}

function parseScenario(request: NormalizedImageRequest): FakeScenario {
  if (request.scenario) return request.scenario;
  const m = request.prompt.match(/__SCENARIO:([A-Z0-9_]+)__/);
  if (m?.[1]) return m[1] as FakeScenario;
  const meta = request.clientMetadata?.scenario;
  if (typeof meta === 'string') return meta as FakeScenario;
  return 'SUCCESS';
}

function webhookSecret(): string {
  return process.env.FAKE_WEBHOOK_SECRET ?? 'fake-webhook-secret';
}

function makeJobId(submissionKey: string): string {
  return `fake-job-${createHash('sha256').update(submissionKey).digest('hex').slice(0, 24)}`;
}

function failClass(scenario: FakeScenario): ProviderErrorClass | null {
  switch (scenario) {
    case 'AUTH':
      return 'AUTH';
    case 'VALIDATION':
      return 'VALIDATION';
    case 'POLICY':
      return 'POLICY';
    case 'RATE_LIMIT':
      return 'RATE_LIMIT';
    case 'TRANSIENT':
      return 'TRANSIENT';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'QUOTA':
      return 'QUOTA';
    case 'UNKNOWN':
      return 'UNKNOWN';
    default:
      return null;
  }
}

/**
 * Fake ImageProviderAdapter — full failure matrix (W4-01 / W4-06).
 * Never reads real API keys.
 */
export class FakeImageProviderAdapter implements ImageProviderAdapter {
  readonly providerKey = 'fake';

  async getCapabilities(modelId: string): Promise<ModelCapabilities> {
    const m = FAKE_PRIMARY_MODEL;
    if (modelId !== m.modelId && modelId !== m.key) {
      throw new ProviderAdapterError('VALIDATION', `Unknown model ${modelId}`, 400);
    }
    return {
      modelId: m.modelId,
      operations: [...m.operations],
      ratios: [...m.ratios],
      resolutionTiers: [...m.resolutionTiers],
      maxReferenceImages: m.maxReferenceImages,
      maxOutputs: m.maxOutputs,
      supportsSeed: m.supportsSeed,
      supportsWebhook: m.supportsWebhook,
    };
  }

  async estimateCost(request: NormalizedImageRequest): Promise<MoneyEstimate> {
    const count = request.count ?? 1;
    const unit = FAKE_PRIMARY_MODEL.pricing.estimatedUnitCost;
    const estimatedMicrounits = Math.round(unit * 1_000_000 * count);
    if (request.scenario === 'COST_MISMATCH' || parseScenario(request) === 'COST_MISMATCH') {
      return {
        currency: 'USD',
        estimatedMicrounits,
        unitCount: count,
      };
    }
    return { currency: 'USD', estimatedMicrounits, unitCount: count };
  }

  async submit(request: NormalizedImageRequest): Promise<ProviderSubmission> {
    if (!request.idempotencyKey) {
      throw new ProviderAdapterError('VALIDATION', 'idempotencyKey required', 400);
    }
    const existingId = bySubmission.get(request.idempotencyKey);
    if (existingId) {
      const existing = jobs.get(existingId)!;
      return {
        externalJobId: existing.externalJobId,
        submissionKey: existing.submissionKey,
        status: existing.status === 'SUCCEEDED' ? 'SUCCEEDED' : existing.status === 'FAILED' ? 'FAILED' : 'ACCEPTED',
        estimatedCostMicrounits: existing.estimatedCostMicrounits,
      };
    }

    const scenario = parseScenario(request);
    const estimate = await this.estimateCost({ ...request, scenario });
    const actual =
      scenario === 'COST_MISMATCH'
        ? Math.round(estimate.estimatedMicrounits * 1.5)
        : estimate.estimatedMicrounits;

    // Permanent failures that reject at submit time
    const immediate = failClass(scenario);
    if (immediate && scenario !== 'RATE_LIMIT_THEN_SUCCESS' && scenario !== 'DELAYED_SUCCESS') {
      if (['AUTH', 'VALIDATION', 'POLICY', 'QUOTA'].includes(immediate)) {
        throw new ProviderAdapterError(immediate, `Fake provider ${immediate}`, immediate === 'AUTH' ? 401 : 400);
      }
    }

    const externalJobId = makeJobId(request.idempotencyKey);
    const job: InternalJob = {
      externalJobId,
      submissionKey: request.idempotencyKey,
      request,
      scenario,
      status: 'QUEUED',
      progress: 0,
      rateLimitHits: 0,
      createdAt: Date.now(),
      canceled: false,
      actualCostMicrounits: actual,
      estimatedCostMicrounits: estimate.estimatedMicrounits,
    };
    jobs.set(externalJobId, job);
    bySubmission.set(request.idempotencyKey, externalJobId);

    // RATE_LIMIT on first submit attempt (caller should retry)
    if (scenario === 'RATE_LIMIT' || scenario === 'RATE_LIMIT_THEN_SUCCESS') {
      job.rateLimitHits += 1;
      if (scenario === 'RATE_LIMIT' || job.rateLimitHits <= 1) {
        // Keep job for recover; surface error
        throw new ProviderAdapterError('RATE_LIMIT', 'Fake 429', 429);
      }
    }

    if (scenario === 'TRANSIENT') {
      throw new ProviderAdapterError('TRANSIENT', 'Fake 503', 503);
    }
    if (scenario === 'TIMEOUT') {
      throw new ProviderAdapterError('TIMEOUT', 'Fake timeout', 504);
    }
    if (scenario === 'UNKNOWN') {
      throw new ProviderAdapterError('UNKNOWN', 'Fake unknown', 500);
    }

    job.status = 'RUNNING';
    job.progress = 10;

    if (scenario === 'DELAYED_SUCCESS' || scenario === 'WEBHOOK_FIRST') {
      // Stay running until poll/webhook advances
      return {
        externalJobId,
        submissionKey: request.idempotencyKey,
        status: 'ACCEPTED',
        estimatedCostMicrounits: estimate.estimatedMicrounits,
      };
    }

    if (scenario === 'LATE_AFTER_CANCEL') {
      return {
        externalJobId,
        submissionKey: request.idempotencyKey,
        status: 'ACCEPTED',
        estimatedCostMicrounits: estimate.estimatedMicrounits,
      };
    }

    // Immediate success path
    job.status = 'SUCCEEDED';
    job.progress = 100;
    return {
      externalJobId,
      submissionKey: request.idempotencyKey,
      status: 'SUCCEEDED',
      estimatedCostMicrounits: estimate.estimatedMicrounits,
    };
  }

  async recoverSubmission(
    submissionKey: string,
  ): Promise<ProviderSubmission | 'NOT_FOUND' | 'UNKNOWN'> {
    const id = bySubmission.get(submissionKey);
    if (!id) return 'NOT_FOUND';
    const job = jobs.get(id);
    if (!job) return 'UNKNOWN';
    return {
      externalJobId: job.externalJobId,
      submissionKey: job.submissionKey,
      status:
        job.status === 'SUCCEEDED'
          ? 'SUCCEEDED'
          : job.status === 'FAILED'
            ? 'FAILED'
            : 'ACCEPTED',
      estimatedCostMicrounits: job.estimatedCostMicrounits,
    };
  }

  async getStatus(externalJobId: string): Promise<ProviderJobStatus> {
    const job = jobs.get(externalJobId);
    if (!job) {
      throw new ProviderAdapterError('VALIDATION', 'Unknown job', 404);
    }

    if (job.canceled && job.scenario !== 'LATE_AFTER_CANCEL') {
      return {
        externalJobId,
        status: 'CANCELED',
        progress: job.progress,
      };
    }

    // Advance delayed jobs on poll
    if (job.scenario === 'DELAYED_SUCCESS' && job.status === 'RUNNING') {
      const age = Date.now() - job.createdAt;
      job.progress = Math.min(99, 10 + Math.floor(age / 50));
      if (age > 100) {
        job.status = 'SUCCEEDED';
        job.progress = 100;
      }
    }

    if (job.scenario === 'RATE_LIMIT_THEN_SUCCESS' && job.status !== 'SUCCEEDED') {
      job.status = 'SUCCEEDED';
      job.progress = 100;
    }

    if (job.scenario === 'WEBHOOK_FIRST' && job.status === 'RUNNING') {
      // Polling alone does not complete — wait for webhook or long poll age
      const age = Date.now() - job.createdAt;
      if (age > 5_000) {
        job.status = 'SUCCEEDED';
        job.progress = 100;
      }
    }

    if (job.scenario === 'LATE_AFTER_CANCEL' && job.canceled) {
      // Late success still available for ingestion as non-current
      return {
        externalJobId,
        status: 'SUCCEEDED',
        progress: 100,
        outputs: [
          {
            bytesBase64: TINY_PNG.toString('base64'),
            mimeType: 'image/png',
            width: job.request.width ?? 1,
            height: job.request.height ?? 1,
          },
        ],
        actualCostMicrounits: job.actualCostMicrounits,
      };
    }

    const err = failClass(job.scenario);
    if (
      err &&
      ['RATE_LIMIT', 'TRANSIENT', 'TIMEOUT', 'UNKNOWN'].includes(job.scenario) &&
      job.status !== 'SUCCEEDED'
    ) {
      job.status = 'FAILED';
      return {
        externalJobId,
        status: 'FAILED',
        errorClass: err,
        errorMessage: `Fake ${err}`,
      };
    }

    if (job.status === 'SUCCEEDED') {
      const corrupt = job.scenario === 'CORRUPT_OUTPUT';
      const w = job.request.width ?? 1;
      const h = job.request.height ?? 1;
      if (corrupt) {
        return {
          externalJobId,
          status: 'SUCCEEDED',
          progress: 100,
          outputs: [
            {
              bytesBase64: Buffer.from('not-an-image').toString('base64'),
              mimeType: 'application/octet-stream',
              width: w,
              height: h,
              role: 'image',
            },
          ],
          actualCostMicrounits: job.actualCostMicrounits,
        };
      }
      const meta = job.request.clientMetadata ?? {};
      const outputs: NonNullable<ProviderJobStatus['outputs']> = [];
      if (job.request.operation === 'EDIT') {
        // Product-lock semantics (Fake): gray stamp encodes locked product fidelity;
        // lightBlend shifts tone. Mask input is required by the node; Fake keeps IMAGE_LIST only.
        const fidelity = typeof meta.fidelity === 'number' ? meta.fidelity : 0.85;
        const lightBlend = typeof meta.lightBlend === 'number' ? meta.lightBlend : 0.5;
        const gray = Math.round(40 + fidelity * 80 + lightBlend * 40);
        outputs.push({
          bytesBase64: makeSolidPngBase64(w, h, Math.min(255, gray)),
          mimeType: 'image/png',
          width: w,
          height: h,
          role: 'image',
        });
        void meta.productLock;
        void meta.maskId;
        void job.request.maskAsset;
      } else if (job.request.operation === 'INPAINT') {
        const strength =
          typeof job.request.strength === 'number'
            ? job.request.strength
            : typeof meta.strength === 'number'
              ? meta.strength
              : 0.6;
        const gray = Math.round(100 + strength * 100);
        outputs.push({
          bytesBase64: makeSolidPngBase64(w, h, gray),
          mimeType: 'image/png',
          width: w,
          height: h,
          role: 'image',
        });
      } else {
        outputs.push({
          bytesBase64: TINY_PNG.toString('base64'),
          mimeType: 'image/png',
          width: w,
          height: h,
          role: 'image',
        });
      }
      if (job.request.operation === 'REMOVE_BACKGROUND') {
        // Full-resolution MASK: solid white PNG at requested WxH (generated below).
        outputs.push({
          bytesBase64: makeSolidPngBase64(w, h, 255),
          mimeType: 'image/png',
          width: w,
          height: h,
          role: 'mask',
        });
      }
      return {
        externalJobId,
        status: 'SUCCEEDED',
        progress: 100,
        outputs,
        actualCostMicrounits: job.actualCostMicrounits,
      };
    }

    return {
      externalJobId,
      status: job.status,
      progress: job.progress,
      actualCostMicrounits: job.actualCostMicrounits,
    };
  }

  async cancel(externalJobId: string): Promise<CancelResult> {
    const job = jobs.get(externalJobId);
    if (!job) return { canceled: false, lateResultPossible: false };
    job.canceled = true;
    if (job.scenario === 'LATE_AFTER_CANCEL') {
      job.status = 'CANCELED';
      return { canceled: true, lateResultPossible: true };
    }
    if (job.status === 'SUCCEEDED') {
      return { canceled: false, lateResultPossible: false };
    }
    job.status = 'CANCELED';
    return { canceled: true, lateResultPossible: false };
  }

  async verifyWebhook(
    headers: Headers,
    rawBody: Uint8Array,
  ): Promise<VerifiedProviderEvent> {
    const sig = headers.get('x-fake-signature') ?? headers.get('X-Fake-Signature');
    if (!sig) {
      throw new ProviderAdapterError('AUTH', 'Missing webhook signature', 401);
    }
    const expected = createHmac('sha256', webhookSecret()).update(rawBody).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ProviderAdapterError('AUTH', 'Invalid webhook signature', 401);
    }
    let parsed: { eventId?: string; externalJobId?: string; status?: string };
    try {
      parsed = JSON.parse(Buffer.from(rawBody).toString('utf8')) as typeof parsed;
    } catch {
      throw new ProviderAdapterError('VALIDATION', 'Invalid JSON body', 400);
    }
    if (!parsed.eventId || !parsed.externalJobId) {
      throw new ProviderAdapterError('VALIDATION', 'eventId and externalJobId required', 400);
    }
    const job = jobs.get(parsed.externalJobId);
    if (job && parsed.status === 'SUCCEEDED') {
      job.status = 'SUCCEEDED';
      job.progress = 100;
    }
    return {
      providerEventId: parsed.eventId,
      externalJobId: parsed.externalJobId,
      status: (parsed.status as ProviderJobStatus['status']) ?? 'RUNNING',
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
      raw: parsed,
    };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    if (error instanceof ProviderAdapterError) {
      return {
        errorClass: error.errorClass,
        message: error.message,
        retryable: shouldAutoRetry(error.errorClass, 0),
        httpStatus: error.httpStatus,
      };
    }
    return {
      errorClass: 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}

/** Helper for tests / e2e to sign Fake webhooks. */
export function signFakeWebhook(rawBody: string | Uint8Array, secret = webhookSecret()): string {
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody) : Buffer.from(rawBody);
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function getFakeAdapter(): FakeImageProviderAdapter {
  return new FakeImageProviderAdapter();
}
