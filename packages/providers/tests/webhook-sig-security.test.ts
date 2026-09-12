import { describe, expect, it, beforeEach } from 'vitest';
import {
  FakeImageProviderAdapter,
  resetFakeProviderState,
  signFakeWebhook,
  ProviderAdapterError,
} from '../src/index.js';

describe('W8-04 webhook signature fail', () => {
  beforeEach(() => resetFakeProviderState());

  it('rejects missing and invalid signatures; accepts valid signed event', async () => {
    const a = new FakeImageProviderAdapter();
    const sub = await a.submit({
      operation: 'GENERATE',
      prompt: 'product on white',
      modelId: 'fake-v1',
      width: 1024,
      height: 1024,
      idempotencyKey: 'w8-wh-1',
      scenario: 'WEBHOOK_FIRST',
    });
    const body = JSON.stringify({
      eventId: 'evt-w8-1',
      externalJobId: sub.externalJobId,
      status: 'SUCCEEDED',
    });
    const raw = new TextEncoder().encode(body);

    await expect(a.verifyWebhook(new Headers({}), raw)).rejects.toBeInstanceOf(ProviderAdapterError);
    await expect(
      a.verifyWebhook(new Headers({ 'x-fake-signature': 'deadbeef' }), raw),
    ).rejects.toMatchObject({ errorClass: 'AUTH' });

    const sig = signFakeWebhook(raw);
    const ev = await a.verifyWebhook(new Headers({ 'x-fake-signature': sig }), raw);
    expect(ev.providerEventId).toBe('evt-w8-1');
  });
});
