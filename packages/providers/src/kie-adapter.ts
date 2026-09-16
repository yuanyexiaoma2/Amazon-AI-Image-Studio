/**
 * Kie.ai ImageProviderAdapter — Phase 2 / P2-A.
 * Real HTTP gateway: createTask + recordInfo poll + optional webhook.
 * Docs: https://docs.kie.ai/  (Market unified jobs API)
 *
 * Never invent model IDs or prices: defaults come from documented Market models;
 * override via env. Secrets never hard-coded.
 */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { shouldAutoRetry, type ProviderErrorClass } from '@studio/domain';
import type {
  CancelResult,
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
import {
  CreateRateLimiter,
  KIE_DEFAULT_CREATE_RATE,
} from './create-rate-limiter.js';

/** Documented Market model IDs (https://docs.kie.ai/market/...). */
export const KIE_DOCUMENTED_GENERATE_MODEL = 'seedream/5-pro-text-to-image';
export const KIE_DOCUMENTED_EDIT_MODEL = 'seedream/5-pro-image-to-image';

/**
 * Documented credit economics (kie.ai billing UI / pricing notes):
 * - 1 credit ≈ $0.005 USD
 * - Seedream 5 Pro createTask callback examples show ~7 creditsConsumed
 */
export const KIE_DOCUMENTED_USD_PER_CREDIT = 0.005;
export const KIE_DOCUMENTED_ESTIMATED_CREDITS = 7;

/** Documented credits endpoint is GET /api/v1/chat/credit (not /user/credits). */
export const KIE_CREDITS_PATH = '/api/v1/chat/credit';
export const KIE_CREATE_TASK_PATH = '/api/v1/jobs/createTask';
export const KIE_RECORD_INFO_PATH = '/api/v1/jobs/recordInfo';

const DEFAULT_BASE_URL = 'https://api.kie.ai';

/** Hosts observed in kie.ai docs for temporary result media (~14 day retention). */
const ALLOWED_MEDIA_HOST_SUFFIXES = [
  'aiquickdraw.com',
  'kie.ai',
  'tempfile.aiquickdraw.com',
  'static.aiquickdraw.com',
];

export type KieAdapterConfig = {
  baseUrl: string;
  apiKey: string;
  generateModelId: string;
  editModelId: string;
  /** Estimated credits per image for budget gate (documented default 7). */
  estimatedCreditsPerImage: number;
  usdPerCredit: number;
  webhookHmacKey?: string;
  createRateMax: number;
  createRateWindowMs: number;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Injected rate limiter (tests). */
  rateLimiter?: CreateRateLimiter;
};

export type KieApiEnvelope = {
  code?: number;
  msg?: string;
  data?: unknown;
};

export function loadKieAdapterConfig(
  env: NodeJS.ProcessEnv = process.env,
): KieAdapterConfig {
  const apiKey = env.KIE_API_KEY?.trim() ?? '';
  if (!apiKey) {
    throw new ProviderAdapterError(
      'AUTH',
      'KIE_API_KEY is required when IMAGE_PROVIDER=kie',
      401,
    );
  }
  return {
    baseUrl: (env.KIE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ''),
    apiKey,
    generateModelId:
      env.KIE_MODEL_GENERATE?.trim() || KIE_DOCUMENTED_GENERATE_MODEL,
    editModelId: env.KIE_MODEL_EDIT?.trim() || KIE_DOCUMENTED_EDIT_MODEL,
    estimatedCreditsPerImage: parsePositiveFloat(
      env.KIE_ESTIMATED_CREDITS_PER_IMAGE,
      KIE_DOCUMENTED_ESTIMATED_CREDITS,
    ),
    usdPerCredit: parsePositiveFloat(
      env.KIE_USD_PER_CREDIT,
      KIE_DOCUMENTED_USD_PER_CREDIT,
    ),
    webhookHmacKey: env.KIE_WEBHOOK_HMAC_KEY?.trim() || undefined,
    createRateMax: parsePositiveInt(
      env.KIE_CREATE_RATE_MAX,
      KIE_DEFAULT_CREATE_RATE.maxCreates,
    ),
    createRateWindowMs: parsePositiveInt(
      env.KIE_CREATE_RATE_WINDOW_MS,
      KIE_DEFAULT_CREATE_RATE.windowMs,
    ),
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isAllowedKieMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_MEDIA_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function mapHttpToErrorClass(
  httpStatus: number,
  code?: number,
  msg?: string,
): ProviderErrorClass {
  const c = code ?? httpStatus;
  const text = (msg ?? '').toLowerCase();
  if (c === 401 || httpStatus === 401) return 'AUTH';
  if (c === 402 || text.includes('credit') || text.includes('quota')) return 'QUOTA';
  if (c === 429 || httpStatus === 429) return 'RATE_LIMIT';
  if (c === 400 || c === 422 || httpStatus === 400 || httpStatus === 422) {
    if (text.includes('nsfw') || text.includes('policy') || text.includes('violat')) {
      return 'POLICY';
    }
    return 'VALIDATION';
  }
  if (c === 408 || httpStatus === 408 || httpStatus === 504) return 'TIMEOUT';
  if (c === 455 || c === 503 || httpStatus === 503 || httpStatus === 502) return 'TRANSIENT';
  if (c === 501 || text.includes('generation failed')) return 'UNKNOWN';
  if (httpStatus >= 500 || (c !== undefined && c >= 500)) return 'TRANSIENT';
  return 'UNKNOWN';
}

function aspectFromRequest(request: NormalizedImageRequest): string {
  if (request.aspectRatio) return request.aspectRatio;
  if (request.width && request.height) {
    const g = gcd(request.width, request.height);
    return `${request.width / g}:${request.height / g}`;
  }
  return '1:1';
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function qualityFromTier(tier?: string): 'basic' | 'high' {
  if (!tier) return 'basic';
  const t = tier.toUpperCase();
  if (t === '2K' || t === '4K' || t === 'HIGH') return 'high';
  return 'basic';
}

/** '1K' | '2K' | '4K' passthrough for nano-banana-pro / gpt-image-2 `resolution`. */
function resolutionFromTier(tier?: string): '1K' | '2K' | '4K' {
  const t = (tier ?? '').toUpperCase();
  if (t === '1K' || t === '4K') return t;
  return '2K';
}

/**
 * Per-model capabilities for kie Market models beyond the Seedream pair
 * (docs.kie.ai OpenAPI 确认，见 domain model-registry.ts 对应条目注释）。
 */
const KIE_FAMILY_CAPABILITIES: Record<string, Omit<ModelCapabilities, 'modelId'>> = {
  'nano-banana-pro': {
    operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'REMOVE_BACKGROUND'],
    ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    resolutionTiers: ['1K', '2K', '4K'],
    maxReferenceImages: 8,
    maxOutputs: 4,
    supportsSeed: false,
    supportsWebhook: true,
  },
  'gpt-image-2-text-to-image': {
    operations: ['GENERATE'],
    ratios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
    resolutionTiers: ['1K', '2K'],
    maxReferenceImages: 0,
    maxOutputs: 4,
    supportsSeed: false,
    supportsWebhook: true,
  },
  'gpt-image-2-image-to-image': {
    operations: ['GENERATE', 'EDIT', 'INPAINT', 'OUTPAINT', 'REMOVE_BACKGROUND'],
    ratios: ['1:1', '9:16', '16:9', '4:3', '3:4'],
    resolutionTiers: ['1K', '2K'],
    maxReferenceImages: 16,
    maxOutputs: 4,
    supportsSeed: false,
    supportsWebhook: true,
  },
};

/**
 * 每模型预估 credits（预算门用）。nano-banana-pro：1K/2K=18、4K=24（第三方双源）；
 * gpt-image-2 官方未公布，保守占位 10。未收录的模型回退到 env 配置默认值。
 */
const KIE_MODEL_CREDIT_ESTIMATES: Record<string, (tier?: string) => number> = {
  'nano-banana-pro': (tier) => (resolutionFromTier(tier) === '4K' ? 24 : 18),
  'gpt-image-2-text-to-image': () => 10,
  'gpt-image-2-image-to-image': () => 10,
};

type RecordInfoData = {
  taskId?: string;
  model?: string;
  state?: string;
  resultJson?: string;
  failCode?: string;
  failMsg?: string;
  progress?: number;
  creditsConsumed?: number;
};

export class KieImageProviderAdapter implements ImageProviderAdapter {
  readonly providerKey = 'kie';
  private readonly config: KieAdapterConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly rateLimiter: CreateRateLimiter;
  /** Local map submissionKey → taskId for recoverSubmission (best-effort in-process). */
  private readonly bySubmission = new Map<string, string>();

  constructor(config: KieAdapterConfig) {
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
    this.rateLimiter =
      config.rateLimiter ??
      new CreateRateLimiter({
        maxCreates: config.createRateMax,
        windowMs: config.createRateWindowMs,
      });
  }

  async getCapabilities(modelId: string): Promise<ModelCapabilities> {
    const known = new Set([
      this.config.generateModelId,
      this.config.editModelId,
      KIE_DOCUMENTED_GENERATE_MODEL,
      KIE_DOCUMENTED_EDIT_MODEL,
      ...Object.keys(KIE_FAMILY_CAPABILITIES),
    ]);
    if (!known.has(modelId)) {
      throw new ProviderAdapterError('VALIDATION', `Unknown kie model ${modelId}`, 400);
    }
    const family = KIE_FAMILY_CAPABILITIES[modelId];
    if (family) return { modelId, ...family };
    const isEdit = modelId === this.config.editModelId || modelId.includes('image-to-image');
    return {
      modelId,
      operations: isEdit
        ? ['EDIT', 'INPAINT', 'OUTPAINT', 'UPSCALE', 'REMOVE_BACKGROUND', 'GENERATE']
        : ['GENERATE'],
      ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      resolutionTiers: ['1K', '2K'],
      maxReferenceImages: isEdit ? 10 : 0,
      maxOutputs: 4,
      supportsSeed: false,
      supportsWebhook: true,
    };
  }

  async estimateCost(request: NormalizedImageRequest): Promise<MoneyEstimate> {
    const count = request.count ?? 1;
    const perImage = request.modelId
      ? (KIE_MODEL_CREDIT_ESTIMATES[request.modelId]?.(request.resolutionTier) ??
        this.config.estimatedCreditsPerImage)
      : this.config.estimatedCreditsPerImage;
    const credits = perImage * count;
    const estimatedMicrounits = Math.round(
      credits * this.config.usdPerCredit * 1_000_000,
    );
    return {
      currency: 'USD',
      estimatedMicrounits,
      unitCount: count,
    };
  }

  /**
   * Account remaining credits (budget gate).
   * Documented path: GET /api/v1/chat/credit → { code, msg, data: number }.
   */
  async getAccountCredits(): Promise<number> {
    const res = await this.requestJson('GET', KIE_CREDITS_PATH);
    if (res.httpStatus === 401 || res.body.code === 401) {
      throw new ProviderAdapterError('AUTH', res.body.msg ?? 'Unauthorized', 401);
    }
    if (res.body.code !== 200 && res.body.code !== undefined && res.body.code !== 505) {
      // Some success examples oddly show non-200; prefer numeric data when present.
      if (typeof res.body.data !== 'number') {
        throw new ProviderAdapterError(
          mapHttpToErrorClass(res.httpStatus, res.body.code, res.body.msg),
          res.body.msg ?? 'credits query failed',
          res.httpStatus,
        );
      }
    }
    if (typeof res.body.data !== 'number') {
      throw new ProviderAdapterError('UNKNOWN', 'Unexpected credits payload', res.httpStatus);
    }
    return res.body.data;
  }

  /** Pre-submit budget gate: ensure account has enough estimated credits. */
  async assertCreditsForRequest(request: NormalizedImageRequest): Promise<void> {
    const estimate = await this.estimateCost(request);
    const neededCredits = Math.ceil(
      estimate.estimatedMicrounits / (this.config.usdPerCredit * 1_000_000),
    );
    const remaining = await this.getAccountCredits();
    if (remaining < neededCredits) {
      throw new ProviderAdapterError(
        'QUOTA',
        `Insufficient kie credits: have ${remaining}, need ~${neededCredits}`,
        402,
      );
    }
  }

  async submit(request: NormalizedImageRequest): Promise<ProviderSubmission> {
    if (!request.idempotencyKey) {
      throw new ProviderAdapterError('VALIDATION', 'idempotencyKey required', 400);
    }
    const existing = this.bySubmission.get(request.idempotencyKey);
    if (existing) {
      return {
        externalJobId: existing,
        submissionKey: request.idempotencyKey,
        status: 'ACCEPTED',
      };
    }

    await this.assertCreditsForRequest(request);

    const admit = this.rateLimiter.tryAcquire();
    if (!admit.ok) {
      throw new ProviderAdapterError(
        'RATE_LIMIT',
        `kie create rate limit (~${this.config.createRateMax}/${this.config.createRateWindowMs}ms); retryAfterMs=${admit.retryAfterMs}`,
        429,
      );
    }

    const modelId = this.resolveModelId(request);
    const body = this.buildCreateTaskBody(request, modelId);
    const res = await this.requestJson('POST', KIE_CREATE_TASK_PATH, body);

    if (res.httpStatus === 429 || res.body.code === 429) {
      throw new ProviderAdapterError('RATE_LIMIT', res.body.msg ?? 'Rate limit exceeded', 429);
    }
    if (res.httpStatus === 401 || res.body.code === 401) {
      throw new ProviderAdapterError('AUTH', res.body.msg ?? 'Unauthorized', 401);
    }
    if (res.httpStatus === 402 || res.body.code === 402) {
      throw new ProviderAdapterError('QUOTA', res.body.msg ?? 'Insufficient credits', 402);
    }
    if (
      res.httpStatus >= 400 ||
      (typeof res.body.code === 'number' && res.body.code !== 200 && res.body.code !== 505)
    ) {
      // Accept code 200 only for create; surface others via matrix.
      if (typeof res.body.code === 'number' && res.body.code !== 200) {
        const cls = mapHttpToErrorClass(res.httpStatus, res.body.code, res.body.msg);
        throw new ProviderAdapterError(cls, res.body.msg ?? 'createTask failed', res.httpStatus);
      }
      if (res.httpStatus >= 400) {
        const cls = mapHttpToErrorClass(res.httpStatus, res.body.code, res.body.msg);
        throw new ProviderAdapterError(cls, res.body.msg ?? 'createTask failed', res.httpStatus);
      }
    }

    const data = res.body.data as { taskId?: string } | null;
    const taskId = data?.taskId;
    if (!taskId) {
      throw new ProviderAdapterError('UNKNOWN', 'createTask missing taskId', 500);
    }

    this.bySubmission.set(request.idempotencyKey, taskId);
    const estimate = await this.estimateCost(request);
    return {
      externalJobId: taskId,
      submissionKey: request.idempotencyKey,
      status: 'ACCEPTED',
      estimatedCostMicrounits: estimate.estimatedMicrounits,
    };
  }

  async recoverSubmission(
    submissionKey: string,
  ): Promise<ProviderSubmission | 'NOT_FOUND' | 'UNKNOWN'> {
    const id = this.bySubmission.get(submissionKey);
    if (!id) return 'NOT_FOUND';
    return {
      externalJobId: id,
      submissionKey,
      status: 'ACCEPTED',
    };
  }

  async getStatus(externalJobId: string): Promise<ProviderJobStatus> {
    const path = `${KIE_RECORD_INFO_PATH}?taskId=${encodeURIComponent(externalJobId)}`;
    const res = await this.requestJson('GET', path);

    if (res.httpStatus === 404 || res.body.code === 404) {
      throw new ProviderAdapterError('VALIDATION', res.body.msg ?? 'Task not found', 404);
    }
    if (res.httpStatus === 401 || res.body.code === 401) {
      throw new ProviderAdapterError('AUTH', res.body.msg ?? 'Unauthorized', 401);
    }
    if (res.httpStatus === 429 || res.body.code === 429) {
      throw new ProviderAdapterError('RATE_LIMIT', res.body.msg ?? 'Rate limit exceeded', 429);
    }

    const data = (res.body.data ?? {}) as RecordInfoData;
    const state = (data.state ?? '').toLowerCase();

    if (state === 'waiting' || state === 'queuing') {
      return {
        externalJobId,
        status: 'QUEUED',
        progress: typeof data.progress === 'number' ? data.progress : 5,
      };
    }
    if (state === 'generating') {
      return {
        externalJobId,
        status: 'RUNNING',
        progress: typeof data.progress === 'number' ? data.progress : 50,
      };
    }
    if (state === 'fail') {
      const cls = mapHttpToErrorClass(
        500,
        data.failCode ? Number(data.failCode) || 501 : 501,
        data.failMsg,
      );
      return {
        externalJobId,
        status: 'FAILED',
        errorClass: cls,
        errorMessage: data.failMsg || 'kie task failed',
      };
    }
    if (state !== 'success') {
      return {
        externalJobId,
        status: 'RUNNING',
        progress: typeof data.progress === 'number' ? data.progress : 40,
      };
    }

    const urls = this.parseResultUrls(data.resultJson);
    const outputs: NonNullable<ProviderJobStatus['outputs']> = [];
    for (const url of urls) {
      const downloaded = await this.downloadMedia(url);
      outputs.push({
        url,
        bytesBase64: downloaded.bytes.toString('base64'),
        mimeType: downloaded.mimeType,
        width: downloaded.width,
        height: downloaded.height,
        role: 'image',
      });
    }

    const credits = typeof data.creditsConsumed === 'number' ? data.creditsConsumed : undefined;
    const actualCostMicrounits =
      credits !== undefined
        ? Math.round(credits * this.config.usdPerCredit * 1_000_000)
        : undefined;

    return {
      externalJobId,
      status: 'SUCCEEDED',
      progress: 100,
      outputs,
      actualCostMicrounits,
    };
  }

  async cancel(_externalJobId: string): Promise<CancelResult> {
    // kie.ai Market docs do not expose a cancel endpoint — late results possible.
    return { canceled: false, lateResultPossible: true };
  }

  async verifyWebhook(
    headers: Headers,
    rawBody: Uint8Array,
  ): Promise<VerifiedProviderEvent> {
    let parsed: {
      code?: number;
      msg?: string;
      taskId?: string;
      data?: {
        taskId?: string;
        task_id?: string;
        state?: string;
        resultJson?: string;
        creditsConsumed?: number;
        failMsg?: string;
      };
    };
    try {
      parsed = JSON.parse(Buffer.from(rawBody).toString('utf8')) as typeof parsed;
    } catch {
      throw new ProviderAdapterError('VALIDATION', 'Invalid JSON body', 400);
    }

    const taskId =
      parsed.data?.taskId ??
      parsed.data?.task_id ??
      parsed.taskId;
    if (!taskId) {
      throw new ProviderAdapterError('VALIDATION', 'Missing taskId in webhook body', 400);
    }

    const secret = this.config.webhookHmacKey;
    if (secret) {
      const ts =
        headers.get('x-webhook-timestamp') ?? headers.get('X-Webhook-Timestamp');
      const sig =
        headers.get('x-webhook-signature') ?? headers.get('X-Webhook-Signature');
      if (!ts || !sig) {
        throw new ProviderAdapterError('AUTH', 'Missing webhook signature headers', 401);
      }
      const expected = createHmac('sha256', secret)
        .update(`${taskId}.${ts}`)
        .digest('base64');
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new ProviderAdapterError('AUTH', 'Invalid webhook signature', 401);
      }
    }

    const state = (parsed.data?.state ?? '').toLowerCase();
    let status: ProviderJobStatus['status'] = 'RUNNING';
    if (state === 'success' || parsed.code === 200) status = 'SUCCEEDED';
    else if (state === 'fail' || parsed.code === 501 || parsed.code === 400) status = 'FAILED';

    return {
      providerEventId: `kie-webhook-${taskId}-${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`,
      externalJobId: taskId,
      status,
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

  private resolveModelId(request: NormalizedImageRequest): string {
    if (request.modelId && request.modelId !== 'fake-v1') {
      return request.modelId;
    }
    const op = request.operation;
    if (
      op === 'EDIT' ||
      op === 'INPAINT' ||
      op === 'OUTPAINT' ||
      op === 'UPSCALE' ||
      op === 'REMOVE_BACKGROUND'
    ) {
      return this.config.editModelId;
    }
    return this.config.generateModelId;
  }

  private referenceUrls(request: NormalizedImageRequest): string[] {
    return (request.referenceAssets ?? [])
      .map((a) => a.url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
  }

  private requireReferenceUrls(request: NormalizedImageRequest, what: string): string[] {
    const urls = this.referenceUrls(request);
    if (urls.length === 0) {
      throw new ProviderAdapterError(
        'VALIDATION',
        `${what} 需要 referenceAssets[].url（图生图/编辑类操作必须带参考图）`,
        400,
      );
    }
    return urls;
  }

  private buildCreateTaskBody(
    request: NormalizedImageRequest,
    modelId: string,
  ): Record<string, unknown> {
    const input = this.buildModelInput(request, modelId);
    const body: Record<string, unknown> = {
      model: modelId,
      input,
    };
    if (request.callbackUrl) {
      body.callBackUrl = request.callbackUrl;
    }
    return body;
  }

  /**
   * Per-model-family `input` shapes (docs.kie.ai OpenAPI):
   * - nano-banana-pro: prompt + image_input[] + aspect_ratio + resolution + output_format
   * - gpt-image-2-*:   prompt + aspect_ratio + resolution（i2i 用 input_urls[]）
   * - seedream/*:      prompt + aspect_ratio + quality（i2i 用 image_urls[]）
   * - flux-2/*:        同 seedream，但 resolution 替代 quality
   */
  private buildModelInput(
    request: NormalizedImageRequest,
    modelId: string,
  ): Record<string, unknown> {
    const aspect = aspectFromRequest(request);
    const isEditOp = request.operation !== 'GENERATE';

    if (modelId === 'nano-banana-pro') {
      return {
        prompt: request.prompt.slice(0, 10000),
        image_input: isEditOp
          ? this.requireReferenceUrls(request, 'nano-banana-pro').slice(0, 8)
          : this.referenceUrls(request).slice(0, 8),
        aspect_ratio: aspect,
        resolution: resolutionFromTier(request.resolutionTier),
        output_format: 'png',
      };
    }

    if (modelId.startsWith('gpt-image-2')) {
      const isI2I = modelId.includes('image-to-image');
      if (isEditOp && !isI2I) {
        throw new ProviderAdapterError(
          'VALIDATION',
          '该模型只支持文生图 — 编辑类操作请改用 gpt-image-2-image-to-image',
          400,
        );
      }
      const input: Record<string, unknown> = {
        prompt: request.prompt.slice(0, 20000),
        aspect_ratio: aspect,
        resolution: resolutionFromTier(request.resolutionTier),
      };
      if (isI2I) {
        input.input_urls = this.requireReferenceUrls(request, 'gpt-image-2 图片编辑').slice(0, 16);
      }
      return input;
    }

    const isEdit = modelId.includes('image-to-image') || isEditOp;
    const input: Record<string, unknown> = {
      prompt: request.prompt.slice(0, 5000),
      aspect_ratio: aspect,
      quality: qualityFromTier(request.resolutionTier),
      output_format: 'png',
      nsfw_checker: false,
    };
    // Prefer documented `quality` for Seedream; Flux uses `resolution`.
    if (modelId.startsWith('flux-2/')) {
      delete input.quality;
      input.resolution = qualityFromTier(request.resolutionTier) === 'high' ? '2K' : '1K';
    }
    if (isEdit) {
      input.image_urls = this.requireReferenceUrls(request, 'kie image-to-image').slice(0, 10);
    }
    return input;
  }

  private parseResultUrls(resultJson?: string): string[] {
    if (!resultJson) return [];
    try {
      const parsed = JSON.parse(resultJson) as { resultUrls?: string[] };
      return Array.isArray(parsed.resultUrls)
        ? parsed.resultUrls.filter((u) => typeof u === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private async downloadMedia(
    url: string,
  ): Promise<{ bytes: Buffer; mimeType: string; width: number; height: number }> {
    if (!isAllowedKieMediaUrl(url)) {
      throw new ProviderAdapterError(
        'VALIDATION',
        `Refused media host (not in kie allowlist): ${url}`,
        400,
      );
    }
    const res = await this.fetchImpl(url, { method: 'GET' });
    if (!res.ok) {
      throw new ProviderAdapterError(
        'TRANSIENT',
        `Failed to download kie media: HTTP ${res.status}`,
        res.status,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    // Width/height filled by imaging normalize downstream when needed.
    return { bytes: buf, mimeType, width: 0, height: 0 };
  }

  private async requestJson(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ httpStatus: number; body: KieApiEnvelope }> {
    const url = `${this.config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderAdapterError(
        'TRANSIENT',
        err instanceof Error ? err.message : 'kie network error',
        503,
      );
    }
    let parsed: KieApiEnvelope = {};
    try {
      parsed = (await res.json()) as KieApiEnvelope;
    } catch {
      parsed = { msg: `Non-JSON response HTTP ${res.status}` };
    }
    return { httpStatus: res.status, body: parsed };
  }
}

export function createKieAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<KieAdapterConfig> = {},
): KieImageProviderAdapter {
  return new KieImageProviderAdapter({ ...loadKieAdapterConfig(env), ...overrides });
}
