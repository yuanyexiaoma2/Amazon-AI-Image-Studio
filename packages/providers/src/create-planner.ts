/**
 * Select ShotPlanProvider from PLANNER_PROVIDER env.
 * Default: fake (offline deterministic planner). kie = real LLM planner via
 * kie.ai OpenAI-compatible chat completions — reuses KIE_API_KEY (P2-A).
 */

import {
  KIE_DEFAULT_BASE_URL,
  KIE_DEFAULT_CHAT_PATH,
  KIE_DEFAULT_PLANNER_MODEL,
  OpenAiCompatShotPlanProvider,
  PlannerProviderError,
  type OpenAiCompatPlannerConfig,
} from './openai-compat-planner.js';
import { FakeShotPlanProvider } from './fake.js';
import type { ShotPlanProvider } from './ports.js';

export type PlannerProviderKind = 'fake' | 'kie';

export function resolvePlannerProviderKind(
  env: NodeJS.ProcessEnv = process.env,
): PlannerProviderKind {
  const raw = (env.PLANNER_PROVIDER ?? 'fake').trim().toLowerCase();
  if (raw === 'kie' || raw === 'kie.ai' || raw === 'kieai') return 'kie';
  return 'fake';
}

export type CreateShotPlanProviderOptions = {
  env?: NodeJS.ProcessEnv;
  /** Test overrides for the kie planner HTTP layer. */
  kieOverrides?: Partial<OpenAiCompatPlannerConfig>;
};

export function createShotPlanProvider(
  options: CreateShotPlanProviderOptions = {},
): ShotPlanProvider {
  const env = options.env ?? process.env;
  const kind = resolvePlannerProviderKind(env);
  if (kind === 'kie') {
    const apiKey = env.KIE_API_KEY?.trim();
    if (!apiKey) {
      throw new PlannerProviderError(
        'AUTH',
        'KIE_API_KEY is required when PLANNER_PROVIDER=kie',
      );
    }
    return new OpenAiCompatShotPlanProvider({
      apiKey,
      baseUrl: env.KIE_BASE_URL?.trim() || KIE_DEFAULT_BASE_URL,
      chatPath: KIE_DEFAULT_CHAT_PATH,
      model: env.KIE_LLM_MODEL?.trim() || KIE_DEFAULT_PLANNER_MODEL,
      providerName: 'kie-llm-shot-plan',
      ...options.kieOverrides,
    });
  }
  return new FakeShotPlanProvider();
}
