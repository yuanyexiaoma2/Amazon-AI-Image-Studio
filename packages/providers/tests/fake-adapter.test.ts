import { describe, expect, it, beforeEach } from 'vitest';
import {
  FakeImageProviderAdapter,
  resetFakeProviderState,
  signFakeWebhook,
  ProviderAdapterError,
} from '../src/index.js';

describe('FakeImageProviderAdapter §9 + W4-06 matrix', () => {
  beforeEach(() => resetFakeProviderState());

  const base = {
    operation: 'GENERATE' as const,
    prompt: 'product on white',
    modelId: 'fake-v1',
    width: 1024,
    height: 1024,
  };

  it('SUCCESS submit + status', async () => {
    const a = new FakeImageProviderAdapter();
    const sub = await a.submit({ ...base, idempotencyKey: 'k1', scenario: 'SUCCESS' });
    expect(sub.status).toBe('SUCCEEDED');
    const st = await a.getStatus(sub.externalJobId);
    expect(st.status).toBe('SUCCEEDED');
    expect(st.outputs?.[0]?.mimeType).toBe('image/png');
  });

  it('AUTH/VALIDATION/POLICY/QUOTA no-retry errors at submit', async () => {
    const a = new FakeImageProviderAdapter();
    for (const scenario of ['AUTH', 'VALIDATION', 'POLICY', 'QUOTA'] as const) {
      resetFakeProviderState();
      await expect(
        a.submit({ ...base, idempotencyKey: `k-${scenario}`, scenario }),
      ).rejects.toMatchObject({ errorClass: scenario });
    }
  });

  it('RATE_LIMIT / TRANSIENT / TIMEOUT / UNKNOWN throw retryable classes', async () => {
    const a = new FakeImageProviderAdapter();
    for (const scenario of ['RATE_LIMIT', 'TRANSIENT', 'TIMEOUT', 'UNKNOWN'] as const) {
      resetFakeProviderState();
      try {
        await a.submit({ ...base, idempotencyKey: `r-${scenario}`, scenario });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderAdapterError);
        const n = a.normalizeError(e);
        expect(n.errorClass).toBe(scenario);
      }
    }
  });

  it('idempotent submit replays same externalJobId', async () => {
    const a = new FakeImageProviderAdapter();
    const s1 = await a.submit({ ...base, idempotencyKey: 'same', scenario: 'SUCCESS' });
    const s2 = await a.submit({ ...base, idempotencyKey: 'same', scenario: 'SUCCESS' });
    expect(s1.externalJobId).toBe(s2.externalJobId);
  });

  it('webhook verify requires raw-body HMAC; duplicate event id ok at adapter', async () => {
    const a = new FakeImageProviderAdapter();
    const sub = await a.submit({
      ...base,
      idempotencyKey: 'wh1',
      scenario: 'WEBHOOK_FIRST',
    });
    const body = JSON.stringify({
      eventId: 'evt-1',
      externalJobId: sub.externalJobId,
      status: 'SUCCEEDED',
    });
    const raw = new TextEncoder().encode(body);
    const sig = signFakeWebhook(raw);
    const ev = await a.verifyWebhook(new Headers({ 'x-fake-signature': sig }), raw);
    expect(ev.providerEventId).toBe('evt-1');
    const st = await a.getStatus(sub.externalJobId);
    expect(st.status).toBe('SUCCEEDED');
  });

  it('rejects bad webhook signature', async () => {
    const a = new FakeImageProviderAdapter();
    const raw = new TextEncoder().encode('{}');
    await expect(
      a.verifyWebhook(new Headers({ 'x-fake-signature': 'deadbeef' }), raw),
    ).rejects.toMatchObject({ errorClass: 'AUTH' });
  });

  it('cancel + late result possible', async () => {
    const a = new FakeImageProviderAdapter();
    const sub = await a.submit({
      ...base,
      idempotencyKey: 'late1',
      scenario: 'LATE_AFTER_CANCEL',
    });
    const c = await a.cancel!(sub.externalJobId);
    expect(c.canceled).toBe(true);
    expect(c.lateResultPossible).toBe(true);
    const st = await a.getStatus(sub.externalJobId);
    expect(st.status).toBe('SUCCEEDED');
  });

  it('estimateCost returns microunits', async () => {
    const a = new FakeImageProviderAdapter();
    const e = await a.estimateCost({ ...base, idempotencyKey: 'c', count: 2 });
    expect(e.estimatedMicrounits).toBe(20_000);
    expect(e.unitCount).toBe(2);
  });
});

describe('Fake REMOVE_BACKGROUND (W5-02)', () => {
  it('returns image + full-res MASK output roles', async () => {
    resetFakeProviderState();
    const a = new FakeImageProviderAdapter();
    const sub = await a.submit({
      operation: 'REMOVE_BACKGROUND',
      prompt: 'cutout',
      modelId: 'fake-v1',
      idempotencyKey: 'rb-1',
      width: 2048,
      height: 2048,
      scenario: 'SUCCESS',
    });
    const st = await a.getStatus(sub.externalJobId);
    expect(st.status).toBe('SUCCEEDED');
    expect(st.outputs?.length).toBe(2);
    expect(st.outputs?.[0]?.role).toBe('image');
    expect(st.outputs?.[1]?.role).toBe('mask');
    expect(st.outputs?.[1]?.width).toBe(2048);
    expect(st.outputs?.[1]?.height).toBe(2048);
    const maskBytes = Buffer.from(st.outputs![1]!.bytesBase64!, 'base64');
    expect(maskBytes[0]).toBe(0x89); // PNG magic
  });
});

describe('Fake EDIT / INPAINT (W5-04/05)', () => {
  it('EDIT replace_background demonstrates product-lock via fidelity stamp + mask echo', async () => {
    resetFakeProviderState();
    const a = new FakeImageProviderAdapter();
    const sub = await a.submit({
      operation: 'EDIT',
      prompt: 'studio backdrop',
      modelId: 'fake-v1',
      idempotencyKey: 'edit-1',
      width: 1024,
      height: 1024,
      scenario: 'SUCCESS',
      clientMetadata: { productLock: true, fidelity: 0.9, lightBlend: 0.4, maskId: 'm1' },
    });
    const st = await a.getStatus(sub.externalJobId);
    expect(st.status).toBe('SUCCEEDED');
    expect(st.outputs?.[0]?.role).toBe('image');
    expect(st.outputs?.[0]?.width).toBe(1024);
    expect(st.outputs?.every((o) => o.role === 'image')).toBe(true);
  });

  it('INPAINT uses strength to vary output stamp', async () => {
    resetFakeProviderState();
    const a = new FakeImageProviderAdapter();
    const sub = await a.submit({
      operation: 'INPAINT',
      prompt: 'fix scratch',
      modelId: 'fake-v1',
      idempotencyKey: 'inp-1',
      width: 512,
      height: 512,
      strength: 0.75,
      scenario: 'SUCCESS',
    });
    const st = await a.getStatus(sub.externalJobId);
    expect(st.status).toBe('SUCCEEDED');
    expect(st.outputs?.[0]?.role).toBe('image');
    expect(st.outputs?.[0]?.width).toBe(512);
  });
});

describe('Fake OUTPAINT / UPSCALE (W5-06/07)', () => {
  it('OUTPAINT returns IMAGE at canvas WxH with placement metadata', async () => {
    resetFakeProviderState();
    const a = new FakeImageProviderAdapter();
    const sub = await a.submit({
      operation: 'OUTPAINT',
      prompt: 'expand frame',
      modelId: 'fake-v1',
      idempotencyKey: 'out-1',
      width: 1778,
      height: 1000,
      aspectRatio: '16:9',
      scenario: 'SUCCESS',
      clientMetadata: {
        placement: 'left',
        targetRatio: '16:9',
        offsetX: 0,
        offsetY: 0,
        sourceWidth: 1000,
        sourceHeight: 1000,
      },
    });
    const st = await a.getStatus(sub.externalJobId);
    expect(st.status).toBe('SUCCEEDED');
    expect(st.outputs?.[0]?.role).toBe('image');
    expect(st.outputs?.[0]?.width).toBe(1778);
    expect(st.outputs?.[0]?.height).toBe(1000);
    expect(st.outputs?.[0]?.mimeType).toBe('image/png');
  });

  it('UPSCALE returns PNG at target resolution dims', async () => {
    resetFakeProviderState();
    const a = new FakeImageProviderAdapter();
    const sub = await a.submit({
      operation: 'UPSCALE',
      prompt: 'upscale',
      modelId: 'fake-v1',
      idempotencyKey: 'up-1',
      width: 4096,
      height: 2048,
      resolutionTier: '4K',
      scenario: 'SUCCESS',
      clientMetadata: { engineKey: 'default-upscale', targetResolution: '4K' },
    });
    const st = await a.getStatus(sub.externalJobId);
    expect(st.status).toBe('SUCCEEDED');
    expect(st.outputs?.[0]?.role).toBe('image');
    expect(st.outputs?.[0]?.width).toBe(4096);
    expect(st.outputs?.[0]?.height).toBe(2048);
    expect(st.outputs?.[0]?.mimeType).toBe('image/png');
  });

  it('OUTPAINT AUTH failure is permanent (no auto-retry class)', async () => {
    resetFakeProviderState();
    const a = new FakeImageProviderAdapter();
    await expect(
      a.submit({
        operation: 'OUTPAINT',
        prompt: 'x',
        modelId: 'fake-v1',
        idempotencyKey: 'out-auth',
        scenario: 'AUTH',
      }),
    ).rejects.toMatchObject({ errorClass: 'AUTH' });
  });
});
