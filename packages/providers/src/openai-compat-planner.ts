/**
 * OpenAI-compatible Shot Plan Provider (V2 planner agent).
 *
 * Drafts selling-point-aware shot briefs from the owner's intent + confirmed
 * Truth Pack facts via any OpenAI-compatible `chat/completions` endpoint.
 * Primary target: kie.ai (`POST {KIE_BASE_URL}/api/v1/chat/completions`) so a
 * single KIE_API_KEY powers both image generation and the planner LLM.
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

export type PlannerErrorClass =
  | 'AUTH'
  | 'VALIDATION'
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'TIMEOUT'
  | 'UNKNOWN';

export class PlannerProviderError extends Error {
  constructor(
    readonly errorClass: PlannerErrorClass,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'PlannerProviderError';
  }
}

export type OpenAiCompatPlannerConfig = {
  apiKey: string;
  /** Default https://api.kie.ai (no trailing slash). */
  baseUrl?: string;
  /** Chat completions path. Default /api/v1/chat/completions (kie unified). */
  chatPath?: string;
  /** Model ID, e.g. gemini/gemini-2.5-flash (kie provider/model convention). */
  model?: string;
  timeoutMs?: number;
  /** Provider label reported in results/audit, e.g. kie-llm-shot-plan. */
  providerName?: string;
  /** Test hook: inject a fetch implementation. */
  fetchImpl?: typeof fetch;
};

export const KIE_DEFAULT_BASE_URL = 'https://api.kie.ai';
export const KIE_DEFAULT_PLANNER_MODEL = 'gemini-3-flash';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * kie.ai LLM chat endpoint shape (docs.kie.ai/market/gemini/*):
 * POST {baseUrl}/{model-slug}/v1/chat/completions — model in the PATH,
 * OpenAI-compatible body. NOT the unified /api/v1/chat/completions
 * (returns "feature not supported" for LLMs).
 */
export function kieChatPathForModel(model: string): string {
  const slug = model.trim().replace(/^\/+|\/+$/g, '');
  return `/${slug}/v1/chat/completions`;
}

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

/** Extract the first JSON object from raw model text (tolerates stray prose/fences). */
export function extractJsonObject(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new PlannerProviderError('VALIDATION', 'Planner LLM returned no JSON object');
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    throw new PlannerProviderError(
      'VALIDATION',
      `Planner LLM returned unparseable JSON: ${(e as Error).message}`,
    );
  }
}

function normalizeHttpError(status: number, bodyText: string): PlannerProviderError {
  if (status === 401 || status === 403) {
    return new PlannerProviderError('AUTH', `Planner LLM auth failed (${status})`, status);
  }
  if (status === 429) {
    return new PlannerProviderError('RATE_LIMIT', 'Planner LLM rate limited (429)', status);
  }
  if (status === 400 || status === 404) {
    return new PlannerProviderError(
      'VALIDATION',
      `Planner LLM rejected request (${status}): ${bodyText.slice(0, 200)}`,
      status,
    );
  }
  if (status >= 500) {
    return new PlannerProviderError('TRANSIENT', `Planner LLM server error (${status})`, status);
  }
  return new PlannerProviderError('UNKNOWN', `Planner LLM unexpected status ${status}`, status);
}

export class OpenAiCompatShotPlanProvider implements ShotPlanProvider {
  readonly name: string;
  private readonly config: {
    apiKey: string;
    baseUrl: string;
    chatPath: string;
    model: string;
    timeoutMs: number;
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
      chatPath: config.chatPath ?? kieChatPathForModel(model),
      model,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: config.fetchImpl ?? fetch,
    };
    this.name = config.providerName ?? 'openai-compat-shot-plan';
  }

  async draftPlan(request: ShotPlanDraftRequest): Promise<ShotPlanDraftResult> {
    const started = Date.now();
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

    const url = `${this.config.baseUrl}${this.config.chatPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let res: Response;
    try {
      res = await this.config.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: [{ type: 'text', text: PLANNER_SYSTEM_PROMPT }] },
            {
              role: 'user',
              content: [{ type: 'text', text: buildPlannerPrompt(request, template) }],
            },
          ],
          temperature: 0.7,
          response_format: { type: 'json_object' },
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new PlannerProviderError(
          'TIMEOUT',
          `Planner LLM timed out after ${this.config.timeoutMs}ms`,
        );
      }
      throw new PlannerProviderError(
        'TRANSIENT',
        `Planner LLM network error: ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw normalizeHttpError(res.status, await res.text().catch(() => ''));
    }

    const payload = (await res.json()) as {
      // kie returns HTTP 200 with an error envelope on failures: {code, msg}
      code?: number;
      msg?: string;
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    if (typeof payload.code === 'number' && payload.code >= 400) {
      throw normalizeHttpError(payload.code, payload.msg ?? '');
    }
    const rawContent = payload.choices?.[0]?.message?.content;
    const text = Array.isArray(rawContent)
      ? rawContent.map((p) => p.text ?? '').join('')
      : rawContent;
    if (!text) {
      throw new PlannerProviderError('VALIDATION', 'Planner LLM returned empty content');
    }

    const parsed = LlmPlanSchema.safeParse(extractJsonObject(text));
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
      latencyMs: Date.now() - started,
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
