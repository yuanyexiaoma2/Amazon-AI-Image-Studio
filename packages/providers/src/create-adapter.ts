/**
 * Select ImageProviderAdapter from IMAGE_PROVIDER env.
 * Default: fake (ADR-0001). kie = Phase 2 / P2-A real gateway.
 */

import type { ImageProviderAdapter } from './image-adapter.js';
import { FakeImageProviderAdapter } from './fake-adapter.js';
import {
  createKieAdapterFromEnv,
  KieImageProviderAdapter,
  type KieAdapterConfig,
} from './kie-adapter.js';
import { ProviderAdapterError } from './image-adapter.js';

export type ImageProviderKind = 'fake' | 'kie' | 'openai' | 'google';

export function resolveImageProviderKind(
  env: NodeJS.ProcessEnv = process.env,
): ImageProviderKind {
  const raw = (env.IMAGE_PROVIDER ?? 'fake').trim().toLowerCase();
  if (raw === 'kie' || raw === 'kie.ai' || raw === 'kieai') return 'kie';
  if (raw === 'openai' || raw === 'google') return raw;
  return 'fake';
}

export type CreateImageAdapterOptions = {
  env?: NodeJS.ProcessEnv;
  /** Test overrides for kie HTTP client / rate limiter. */
  kieOverrides?: Partial<KieAdapterConfig>;
};

/**
 * Factory used by worker + webhook + inline generation handler.
 */
export function createImageAdapter(
  options: CreateImageAdapterOptions = {},
): ImageProviderAdapter {
  const env = options.env ?? process.env;
  const kind = resolveImageProviderKind(env);
  switch (kind) {
    case 'fake':
      return new FakeImageProviderAdapter();
    case 'kie':
      return createKieAdapterFromEnv(env, options.kieOverrides);
    case 'openai':
    case 'google':
      throw new ProviderAdapterError(
        'VALIDATION',
        `IMAGE_PROVIDER=${kind} is not implemented; use fake or kie (P2-A)`,
        400,
      );
    default:
      return new FakeImageProviderAdapter();
  }
}

export function isKieAdapter(
  adapter: ImageProviderAdapter,
): adapter is KieImageProviderAdapter {
  return adapter.providerKey === 'kie';
}

/** Poll interval: Fake is near-instant; kie docs recommend 2–3s backoff. */
export function resolveProviderPollIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const override = env.PROVIDER_POLL_INTERVAL_MS;
  if (override && Number.parseInt(override, 10) > 0) {
    return Number.parseInt(override, 10);
  }
  return resolveImageProviderKind(env) === 'kie' ? 2500 : 25;
}

/** Cap worker concurrency when using kie so create-rate (~20/10s) is respected. */
export function resolveKieAwareWorkerConcurrency(
  env: NodeJS.ProcessEnv = process.env,
  baseConcurrency: number,
): number {
  if (resolveImageProviderKind(env) !== 'kie') return baseConcurrency;
  const cap = Number.parseInt(env.KIE_WORKER_CONCURRENCY_CAP ?? '4', 10);
  const limit = Number.isFinite(cap) && cap > 0 ? cap : 4;
  return Math.min(baseConcurrency, limit);
}

/** Max getStatus polls before giving up (kie docs: stop after 10–15 minutes). */
export function resolveProviderMaxPolls(env: NodeJS.ProcessEnv = process.env): number {
  const override = env.PROVIDER_MAX_POLLS;
  if (override && Number.parseInt(override, 10) > 0) {
    return Number.parseInt(override, 10);
  }
  return resolveImageProviderKind(env) === 'kie' ? 360 : 40;
}

