/**
 * OpenAI-compatible Shot Plan Provider (V2 planner agent).
 *
 * Drafts selling-point-aware shot briefs from the owner's intent + confirmed
 * Truth Pack facts via the shared kie chat client (`./kie-chat.ts`).
 * Primary target: kie.ai so a single KIE_API_KEY powers both image generation
 * and the planner LLM.
 *
 * Safety design:
 * - Deterministic fields (slot set, orderIndex, aspectRatio, targetPixels,
 *   qaPolicy) ALWAYS come from the domain 7-image template — never from the
 *   LLM. The model only fills creative fields (purpose / copy / must / mustNot).
 * - Response is parsed + validated with Zod; malformed output throws a
 *   VALIDATION PlannerProviderError (caller may retry or fall back to Fake).
 * - API key comes from env only; never logged, never stored, never in repo.
 */

import { z } from 'zod';
import { DEFAULT_SEVEN_IMAGE_TEMPLATE } from '@studio/domain';
import type {
  PlannedShotBrief,
  ShotPlanDraftRequest,
  ShotPlanDraftResult,
  ShotPlanProvider,
} from './ports.js';
import {
  ChatProviderError,
  KIE_DEFAULT_BASE_URL,
  KIE_DEFAULT_LLM_MODEL,
  extractJsonObject,
  kieChatCompletion,
  type ChatErrorClass,
  type KieChatConfig,
} from './kie-chat.js';

export {
  extractJsonObject,
  kieChatPathForModel,
  KIE_DEFAULT_BASE_URL,
} from './kie-chat.js';

export type PlannerErrorClass = ChatErrorClass;

export class PlannerProviderError extends ChatProviderError {
  constructor(errorClass: PlannerErrorClass, message: string, httpStatus?: number) {
    super(errorClass, message, httpStatus);
    this.name = 'PlannerProviderError';
  }
}

export type OpenAiCompatPlannerConfig = {
  apiKey: string;
  /** Default https://api.kie.ai (no trailing slash). */
  baseUrl?: string;
  /** Chat completions path. Default /{model}/v1/chat/completions (kie Market). */
  chatPath?: string;
  /** Model ID, e.g. gemini-3-flash (kie provider/model convention). */
  model?: string;
  timeoutMs?: number;
  /** Provider label reported in results/audit, e.g. kie-llm-shot-plan. */
  providerName?: string;
  /** Test hook: inject a fetch implementation. */
  fetchImpl?: typeof fetch;
};

export const KIE_DEFAULT_PLANNER_MODEL = KIE_DEFAULT_LLM_MODEL;

/** Creative fields the LLM is allowed to fill, per slot+orderIndex. */
const LlmBriefSchema = z.object({
  orderIndex: z.number().int().min(1),
  slot: z.enum(['MAIN', 'FEATURE', 'DETAIL', 'DIMENSION', 'LIFESTYLE', 'PACKAGE']),
  purpose: z.string().min(1).max(500),
  copy: z
    .array(z.object({ text: z.string().min(1).max(200), source: z.string().max(100) }))
    .max(6)
    .default([]),
  must: z.array(z.string().min(1).max(200)).max(10).default([]),
  mustNot: z.array(z.string().min(1).max(200)).max(10).default([]),
});

const LlmPlanSchema = z.object({
  briefs: z.array(LlmBriefSchema).min(1).max(12),
});

type LlmPlan = z.infer<typeof LlmPlanSchema>;

type TemplateEntry = (typeof DEFAULT_SEVEN_IMAGE_TEMPLATE)[number];

export function buildPlannerPrompt(request: ShotPlanDraftRequest, template: TemplateEntry[]): string {
  const facts = (request.confirmedFacts ?? [])
    .map((f) => `- ${f.key}: ${JSON.stringify(f.value)}`)
    .join('\n');
  const templateLines = template.map((t) => `#${t.orderIndex} ${t.slot} — ${t.purpose}`).join('\n');

  return [
    `Draft an Amazon shot plan with exactly ${template.length} briefs for this product.`,
    `SKU: ${request.sku ?? 'UNKNOWN'}`,
    `Category: ${request.category ?? 'general'}`,
    `Marketplace: ${request.marketplace ?? 'US'}`,
    facts ? `Confirmed product facts (ONLY these may be claimed):\n${facts}` : 'No confirmed facts.',
    request.intent
      ? `Owner intent (selling points / scenes / style to honor):\n${request.intent}`
      : '',
    '',
    'Slot skeleton (keep the same orderIndex and slot values):',
    templateLines,
    '',
    'For each brief fill:',
    '- purpose: specific to THIS product and its selling points',
    '- copy: overlay text ideas backed ONLY by confirmed facts (empty array for MAIN)',
    '- must: 3-6 shot requirements',
    '- mustNot: 3-6 prohibitions',
    'Rules: never invent specifications, certifications, or quantities; each FEATURE brief covers a distinct selling point; LIFESTYLE describes a concrete usage scene fitting the category.',
    'Respond with JSON only: {"briefs":[{orderIndex,slot,purpose,copy:[{text,source}],must:[],mustNot:[]}]} — no markdown fences.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const PLANNER_SYSTEM_PROMPT =
  'You are an Amazon product-image art director. You draft truthful, conversion-focused shot plans and output strict JSON only.';

export class OpenAiCompatShotPlanProvider implements ShotPlanProvider {
  readonly name: string;
  private readonly config: {
    apiKey: string;
    baseUrl: string;
    chatPath?: string;
    model: string;
    timeoutMs?: number;
    fetchImpl: typeof fetch;
  };

  constructor(config: OpenAiCompatPlannerConfig) {
    if (!config.apiKey?.trim()) {
      throw new PlannerProviderError('AUTH', 'An API key is required for a real planner provider');
    }
    const model = config.model ?? KIE_DEFAULT_PLANNER_MODEL;
    this.config = {
      apiKey: config.apiKey,
      baseUrl: (config.baseUrl ?? KIE_DEFAULT_BASE_URL).replace(/\/+$/, ''),
      chatPath: config.chatPath,
      model,
      timeoutMs: config.timeoutMs,
      fetchImpl: config.fetchImpl ?? fetch,
    };
    this.name = config.providerName ?? 'openai-compat-shot-plan';
  }

  async draftPlan(request: ShotPlanDraftRequest): Promise<ShotPlanDraftResult> {
    const template: TemplateEntry[] = [...DEFAULT_SEVEN_IMAGE_TEMPLATE];
    if (request.includePackage) {
      template.push({
        slot: 'PACKAGE',
        purpose: "Packaging / what's in the box",
        orderIndex: template.length + 1,
        aspectRatio: '1:1',
        targetPixels: { width: 2000, height: 2000 },
        must: ['show only included pack contents'],
        mustNot: ['unincluded accessory'],
        qaPolicy: 'amazon-package-us-v1',
      });
    }

    const kieConfig: KieChatConfig = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      chatPath: this.config.chatPath,
      model: this.config.model,
      timeoutMs: this.config.timeoutMs,
      fetchImpl: this.config.fetchImpl,
    };

    let completion;
    try {
      completion = await kieChatCompletion({
        config: kieConfig,
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: buildPlannerPrompt(request, template) },
        ],
        temperature: 0.7,
        jsonMode: true,
      });
    } catch (e) {
      if (e instanceof ChatProviderError) {
        throw new PlannerProviderError(e.errorClass, e.message, e.httpStatus);
      }
      throw e;
    }

    let raw: unknown;
    try {
      raw = extractJsonObject(completion.text);
    } catch (e) {
      if (e instanceof ChatProviderError) {
        throw new PlannerProviderError(e.errorClass, e.message, e.httpStatus);
      }
      throw e;
    }

    const parsed = LlmPlanSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PlannerProviderError(
        'VALIDATION',
        `Planner LLM output failed schema validation: ${parsed.error.issues
          .map((i) => i.message)
          .slice(0, 3)
          .join('; ')}`,
      );
    }

    return {
      provider: this.name,
      modelId: this.config.model,
      briefs: mergeWithTemplate(template, parsed.data),
      latencyMs: completion.latencyMs,
    };
  }
}

/**
 * Deterministic skeleton (slots/order/ratio/pixels/qaPolicy) always wins;
 * LLM creative fields fill by orderIndex. Missing slots fall back to the
 * template's own purpose/must/mustNot so the plan is always complete.
 */
export function mergeWithTemplate(template: TemplateEntry[], llm: LlmPlan): PlannedShotBrief[] {
  const byOrder = new Map(llm.briefs.map((b) => [b.orderIndex, b]));
  return template.map((t) => {
    const creative = byOrder.get(t.orderIndex);
    const slotMatches = Boolean(creative && creative.slot === t.slot);
    return {
      slot: t.slot,
      orderIndex: t.orderIndex,
      aspectRatio: t.aspectRatio,
      targetPixels: { ...t.targetPixels },
      qaPolicy: t.qaPolicy,
      purpose:
        slotMatches && creative!.purpose.trim() ? creative!.purpose.trim() : t.purpose,
      copy: slotMatches ? creative!.copy.map((c) => ({ text: c.text, source: c.source })) : [],
      must:
        slotMatches && creative!.must.length > 0
          ? [...new Set([...t.must, ...creative!.must])]
          : [...t.must],
      mustNot:
        slotMatches && creative!.mustNot.length > 0
          ? [...new Set([...t.mustNot, ...creative!.mustNot])]
          : [...t.mustNot],
      referencedAssetVersionIds: [],
    };
  });
}
