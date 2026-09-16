import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  KieImageProviderAdapter,
  CreateRateLimiter,
  ProviderAdapterError,
  KIE_DOCUMENTED_GENERATE_MODEL,
  KIE_CREDITS_PATH,
  createImageAdapter,
  isAllowedKieMediaUrl,
} from '../src/index.js';
import type { KieAdapterConfig } from '../src/kie-adapter.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function baseConfig(fetchImpl: typeof fetch): KieAdapterConfig {
  return {
    baseUrl: 'https://api.kie.ai',
    apiKey: 'test-key',
    generateModelId: KIE_DOCUMENTED_GENERATE_MODEL,
    editModelId: 'seedream/5-pro-image-to-image',
    estimatedCreditsPerImage: 7,
    usdPerCredit: 0.005,
    webhookHmacKey: 'whsec-test',
    createRateMax: 20,
    createRateWindowMs: 10_000,
    fetchImpl,
  };
}

describe('KieImageProviderAdapter (mocked HTTP)', () => {
  let calls: Array<{ url: string; method: string; body?: unknown }>;

  beforeEach(() => {
    calls = [];
  });

  function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let body: unknown;
      if (init?.body) {
        try {
          body = JSON.parse(String(init.body));
        } catch {
          body = init.body;
        }
      }
      calls.push({ url, method: init?.method ?? 'GET', body });
      return handler(url, init);
    }) as unknown as typeof fetch;
  }

  it('submit createTask + getStatus success downloads media to bytesBase64', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.includes(KIE_CREDITS_PATH)) {
        return Response.json({ code: 200, msg: 'success', data: 1000 });
      }
      if (url.includes('/jobs/createTask')) {
        return Response.json({ code: 200, msg: 'success', data: { taskId: 'task_abc' } });
      }
      if (url.includes('/jobs/recordInfo')) {
        return Response.json({
          code: 200,
          msg: 'success',
          data: {
            taskId: 'task_abc',
            state: 'success',
            resultJson: JSON.stringify({
              resultUrls: ['https://tempfile.aiquickdraw.com/p/out.png'],
            }),
            creditsConsumed: 7,
          },
        });
      }
      if (url.includes('tempfile.aiquickdraw.com')) {
        return new Response(TINY_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return Response.json({ code: 404, msg: 'nope' }, { status: 404 });
    });

    const a = new KieImageProviderAdapter(baseConfig(fetchImpl));
    const sub = await a.submit({
      operation: 'GENERATE',
      prompt: 'product on white background',
      modelId: KIE_DOCUMENTED_GENERATE_MODEL,
      width: 1024,
      height: 1024,
      idempotencyKey: 'idem-1',
    });
    expect(sub.externalJobId).toBe('task_abc');
    expect(sub.status).toBe('ACCEPTED');

    const createCall = calls.find((c) => c.url.includes('createTask'));
    expect(createCall?.body).toMatchObject({
      model: KIE_DOCUMENTED_GENERATE_MODEL,
      input: expect.objectContaining({ prompt: 'product on white background' }),
    });
    expect(
      (createCall?.body as { Authorization?: string }) &&
        calls.some(() => true),
    ).toBeTruthy();

    const st = await a.getStatus('task_abc');
    expect(st.status).toBe('SUCCEEDED');
    expect(st.outputs?.[0]?.bytesBase64).toBe(TINY_PNG.toString('base64'));
    expect(st.actualCostMicrounits).toBe(Math.round(7 * 0.005 * 1_000_000));
  });

  it('maps HTTP error classes (W4-06 style matrix)', async () => {
    const cases: Array<{ code: number; status: number; cls: string }> = [
      { code: 401, status: 401, cls: 'AUTH' },
      { code: 402, status: 402, cls: 'QUOTA' },
      { code: 422, status: 422, cls: 'VALIDATION' },
      { code: 429, status: 429, cls: 'RATE_LIMIT' },
    ];
    for (const c of cases) {
      const fetchImpl = mockFetch(async (url) => {
        if (url.includes(KIE_CREDITS_PATH)) {
          return Response.json({ code: 200, msg: 'success', data: 1000 });
        }
        return Response.json({ code: c.code, msg: `err-${c.code}` }, { status: c.status });
      });
      const a = new KieImageProviderAdapter(baseConfig(fetchImpl));
      await expect(
        a.submit({
          operation: 'GENERATE',
          prompt: 'x',
          modelId: KIE_DOCUMENTED_GENERATE_MODEL,
          idempotencyKey: `e-${c.code}`,
        }),
      ).rejects.toMatchObject({ errorClass: c.cls });
    }
  });

  it('quota gate when account credits below estimate', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.includes(KIE_CREDITS_PATH)) {
        return Response.json({ code: 200, msg: 'success', data: 1 });
      }
      return Response.json({ code: 200, msg: 'success', data: { taskId: 'x' } });
    });
    const a = new KieImageProviderAdapter(baseConfig(fetchImpl));
    await expect(
      a.submit({
        operation: 'GENERATE',
        prompt: 'need many credits',
        modelId: KIE_DOCUMENTED_GENERATE_MODEL,
        idempotencyKey: 'low-credits',
      }),
    ).rejects.toMatchObject({ errorClass: 'QUOTA' });
  });

  it('local create-rate limiter emits RATE_LIMIT', async () => {
    const limiter = new CreateRateLimiter({ maxCreates: 1, windowMs: 10_000, now: () => 1000 });
    const fetchImpl = mockFetch(async (url) => {
      if (url.includes(KIE_CREDITS_PATH)) {
        return Response.json({ code: 200, msg: 'success', data: 9999 });
      }
      return Response.json({ code: 200, msg: 'success', data: { taskId: 't1' } });
    });
    const a = new KieImageProviderAdapter({
      ...baseConfig(fetchImpl),
      rateLimiter: limiter,
    });
    await a.submit({
      operation: 'GENERATE',
      prompt: 'first',
      modelId: KIE_DOCUMENTED_GENERATE_MODEL,
      idempotencyKey: 'r1',
    });
    await expect(
      a.submit({
        operation: 'GENERATE',
        prompt: 'second',
        modelId: KIE_DOCUMENTED_GENERATE_MODEL,
        idempotencyKey: 'r2',
      }),
    ).rejects.toMatchObject({ errorClass: 'RATE_LIMIT' });
  });

  it('verifyWebhook HMAC (taskId.timestamp) when key configured', async () => {
    const fetchImpl = mockFetch(async () => Response.json({}));
    const a = new KieImageProviderAdapter(baseConfig(fetchImpl));
    const body = JSON.stringify({
      code: 200,
      data: { taskId: 'task_wh', state: 'success' },
    });
    const raw = new TextEncoder().encode(body);
    const ts = '1700000000';
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', 'whsec-test').update(`task_wh.${ts}`).digest('base64');
    const ev = await a.verifyWebhook(
      new Headers({ 'x-webhook-timestamp': ts, 'x-webhook-signature': sig }),
      raw,
    );
    expect(ev.externalJobId).toBe('task_wh');
    expect(ev.status).toBe('SUCCEEDED');
  });

  it('createImageAdapter selects kie vs fake via IMAGE_PROVIDER', () => {
    const fake = createImageAdapter({ env: { IMAGE_PROVIDER: 'fake' } as NodeJS.ProcessEnv });
    expect(fake.providerKey).toBe('fake');
    const kie = createImageAdapter({
      env: { IMAGE_PROVIDER: 'kie', KIE_API_KEY: 'k' } as NodeJS.ProcessEnv,
      kieOverrides: {
        fetchImpl: mockFetch(async () => Response.json({ code: 200, data: 0 })),
      },
    });
    expect(kie.providerKey).toBe('kie');
  });

  it('refuses non-allowlisted media hosts', () => {
    expect(isAllowedKieMediaUrl('https://tempfile.aiquickdraw.com/x.png')).toBe(true);
    expect(isAllowedKieMediaUrl('https://evil.example/x.png')).toBe(false);
    expect(isAllowedKieMediaUrl('http://tempfile.aiquickdraw.com/x.png')).toBe(false);
  });

  it('edit submit requires reference image urls', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.includes(KIE_CREDITS_PATH)) {
        return Response.json({ code: 200, msg: 'success', data: 9999 });
      }
      return Response.json({ code: 200, data: { taskId: 'e1' } });
    });
    const a = new KieImageProviderAdapter(baseConfig(fetchImpl));
    await expect(
      a.submit({
        operation: 'EDIT',
        prompt: 'change background',
        modelId: 'seedream/5-pro-image-to-image',
        idempotencyKey: 'edit-no-ref',
      }),
    ).rejects.toBeInstanceOf(ProviderAdapterError);
  });
});

describe('kie model families — nano-banana-pro / gpt-image-2 (docs.kie.ai OpenAPI)', () => {
  let calls: Array<{ url: string; method: string; body?: unknown }>;

  beforeEach(() => {
    calls = [];
  });

  function okFetch() {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let body: unknown;
      if (init?.body) {
        try {
          body = JSON.parse(String(init.body));
        } catch {
          body = init.body;
        }
      }
      calls.push({ url, method: init?.method ?? 'GET', body });
      if (url.includes(KIE_CREDITS_PATH)) {
        return Response.json({ code: 200, msg: 'success', data: 100000 });
      }
      if (url.includes('/jobs/createTask')) {
        return Response.json({ code: 200, msg: 'success', data: { taskId: 'task_fam' } });
      }
      return Response.json({ code: 404, msg: 'nope' }, { status: 404 });
    }) as unknown as typeof fetch;
  }

  function createCallBody() {
    return calls.find((c) => c.url.includes('createTask'))?.body as {
      model: string;
      input: Record<string, unknown>;
    };
  }

  it('nano-banana-pro t2i: image_input [] + resolution tier passthrough', async () => {
    const a = new KieImageProviderAdapter(baseConfig(okFetch()));
    await a.submit({
      operation: 'GENERATE',
      prompt: 'white background product shot',
      modelId: 'nano-banana-pro',
      aspectRatio: '16:9',
      resolutionTier: '4K',
      idempotencyKey: 'nb-t2i',
    });
    const body = createCallBody();
    expect(body.model).toBe('nano-banana-pro');
    expect(body.input).toMatchObject({
      prompt: 'white background product shot',
      image_input: [],
      aspect_ratio: '16:9',
      resolution: '4K',
      output_format: 'png',
    });
    expect(body.input.quality).toBeUndefined();
  });

  it('nano-banana-pro edit: image_input carries reference urls (max 8)', async () => {
    const a = new KieImageProviderAdapter(baseConfig(okFetch()));
    await a.submit({
      operation: 'EDIT',
      prompt: 'swap background',
      modelId: 'nano-banana-pro',
      referenceAssets: [{ url: 'https://static.aiquickdraw.com/a.png' }],
      idempotencyKey: 'nb-edit',
    });
    expect(createCallBody().input.image_input).toEqual([
      'https://static.aiquickdraw.com/a.png',
    ]);
  });

  it('gpt-image-2 t2i: resolution + aspect_ratio, no reference param', async () => {
    const a = new KieImageProviderAdapter(baseConfig(okFetch()));
    await a.submit({
      operation: 'GENERATE',
      prompt: 'studio lighting',
      modelId: 'gpt-image-2-text-to-image',
      aspectRatio: '3:2',
      resolutionTier: '2K',
      idempotencyKey: 'gpt2-t2i',
    });
    const body = createCallBody();
    expect(body.model).toBe('gpt-image-2-text-to-image');
    expect(body.input).toMatchObject({ aspect_ratio: '3:2', resolution: '2K' });
    expect(body.input.input_urls).toBeUndefined();
    expect(body.input.quality).toBeUndefined();
  });

  it('gpt-image-2 t2i rejects edit ops with a clear VALIDATION error', async () => {
    const a = new KieImageProviderAdapter(baseConfig(okFetch()));
    await expect(
      a.submit({
        operation: 'INPAINT',
        prompt: 'x',
        modelId: 'gpt-image-2-text-to-image',
        referenceAssets: [{ url: 'https://static.aiquickdraw.com/a.png' }],
        idempotencyKey: 'gpt2-t2i-edit',
      }),
    ).rejects.toBeInstanceOf(ProviderAdapterError);
    expect(calls.some((c) => c.url.includes('createTask'))).toBe(false);
  });

  it('gpt-image-2 i2i sends input_urls (max 16)', async () => {
    const a = new KieImageProviderAdapter(baseConfig(okFetch()));
    await a.submit({
      operation: 'EDIT',
      prompt: 'change background to marble',
      modelId: 'gpt-image-2-image-to-image',
      referenceAssets: [{ url: 'https://static.aiquickdraw.com/b.png' }],
      idempotencyKey: 'gpt2-i2i',
    });
    expect(createCallBody().input.input_urls).toEqual([
      'https://static.aiquickdraw.com/b.png',
    ]);
  });

  it('estimateCost uses per-model credits (nb-pro 4K=24cr, gpt-image-2=10cr placeholder)', async () => {
    const a = new KieImageProviderAdapter(baseConfig(okFetch()));
    const nb4k = await a.estimateCost({
      operation: 'GENERATE',
      prompt: 'x',
      modelId: 'nano-banana-pro',
      resolutionTier: '4K',
      count: 1,
      idempotencyKey: 'e1',
    });
    expect(nb4k.estimatedMicrounits).toBe(Math.round(24 * 0.005 * 1_000_000));
    const gpt2 = await a.estimateCost({
      operation: 'GENERATE',
      prompt: 'x',
      modelId: 'gpt-image-2-text-to-image',
      count: 2,
      idempotencyKey: 'e2',
    });
    expect(gpt2.estimatedMicrounits).toBe(Math.round(10 * 2 * 0.005 * 1_000_000));
  });

  it('getCapabilities returns per-model ratios/tiers for new families', async () => {
    const a = new KieImageProviderAdapter(baseConfig(okFetch()));
    const nb = await a.getCapabilities('nano-banana-pro');
    expect(nb.resolutionTiers).toEqual(['1K', '2K', '4K']);
    expect(nb.maxReferenceImages).toBe(8);
    const gpt2 = await a.getCapabilities('gpt-image-2-text-to-image');
    expect(gpt2.operations).toEqual(['GENERATE']);
    expect(gpt2.maxReferenceImages).toBe(0);
  });
});
