import { describe, expect, it } from 'vitest';
import {
  extractJsonObject,
  mergeWithTemplate,
  OpenAiCompatShotPlanProvider,
  PlannerProviderError,
} from '../src/openai-compat-planner.js';
import { createShotPlanProvider, resolvePlannerProviderKind } from '../src/create-planner.js';
import { FakeShotPlanProvider } from '../src/fake.js';
import { DEFAULT_SEVEN_IMAGE_TEMPLATE } from '@studio/domain';

const KEY = 'test-key-not-real';

function okFetch(body: unknown, capture?: (url: string, init: RequestInit) => void) {
  return (async (url: string | URL, init?: RequestInit) => {
    capture?.(String(url), init ?? {});
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function completion(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

const GOOD_LLM_PLAN = JSON.stringify({
  briefs: [
    {
      orderIndex: 2,
      slot: 'FEATURE',
      purpose: '450ml large capacity for all-day hydration',
      copy: [{ text: '450ml large capacity', source: 'llm' }],
      must: ['show capacity callout'],
      mustNot: ['invented specs'],
    },
    {
      orderIndex: 6,
      slot: 'LIFESTYLE',
      purpose: 'Office desk scene with commuter',
      copy: [],
      must: ['bright nordic style'],
      mustNot: ['clutter'],
    },
  ],
});

describe('resolvePlannerProviderKind / createShotPlanProvider', () => {
  it('defaults to fake', () => {
    expect(resolvePlannerProviderKind({})).toBe('fake');
    expect(createShotPlanProvider({ env: {} })).toBeInstanceOf(FakeShotPlanProvider);
  });

  it('kie without KIE_API_KEY throws AUTH', () => {
    expect(() => createShotPlanProvider({ env: { PLANNER_PROVIDER: 'kie' } })).toThrow(
      PlannerProviderError,
    );
    try {
      createShotPlanProvider({ env: { PLANNER_PROVIDER: 'kie' } });
    } catch (e) {
      expect((e as PlannerProviderError).errorClass).toBe('AUTH');
    }
  });

  it('kie with key returns kie-llm provider', () => {
    const p = createShotPlanProvider({ env: { PLANNER_PROVIDER: 'kie', KIE_API_KEY: KEY } });
    expect(p.name).toBe('kie-llm-shot-plan');
  });
});

describe('OpenAiCompatShotPlanProvider', () => {
  it('sends OpenAI-compatible request and merges creative fields onto template skeleton', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const p = new OpenAiCompatShotPlanProvider({
      apiKey: KEY,
      fetchImpl: okFetch(completion(GOOD_LLM_PLAN), (url, init) => {
        seen = { url, init };
      }),
    });
    const result = await p.draftPlan({
      sku: 'MUG-BLK-450',
      category: 'Kitchen > Drinkware',
      marketplace: 'US',
      confirmedFacts: [{ key: 'brand', value: 'Acme' }],
      intent: '大容量 450ml；18 小时保温；办公场景',
    });

    expect(seen!.url).toBe('https://api.kie.ai/api/v1/chat/completions');
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(seen!.init.body));
    expect(body.model).toBe('gemini/gemini-2.5-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1].content).toContain('大容量 450ml');
    expect(body.messages[1].content).toContain('Acme');

    // Skeleton always from template: 7 briefs, order/ratio/qaPolicy intact
    expect(result.briefs).toHaveLength(7);
    expect(result.briefs[0]?.slot).toBe('MAIN');
    expect(result.briefs[0]?.qaPolicy).toBe('amazon-main-us-v1');
    expect(result.briefs[0]?.targetPixels).toEqual({ width: 2000, height: 2000 });
    // LLM creative merged on matching slot+order
    expect(result.briefs[1]?.purpose).toBe('450ml large capacity for all-day hydration');
    expect(result.briefs[1]?.copy[0]?.text).toBe('450ml large capacity');
    // Template locks preserved + LLM musts appended
    expect(result.briefs[1]?.must).toContain('one primary selling point');
    expect(result.briefs[1]?.must).toContain('show capacity callout');
    // Slots not returned by LLM fall back to template purpose
    expect(result.briefs[4]?.slot).toBe('DIMENSION');
    expect(result.briefs[4]?.purpose).toBe(DEFAULT_SEVEN_IMAGE_TEMPLATE[4]?.purpose);
    expect(result.provider).toBe('openai-compat-shot-plan');
  });

  it('uses custom baseUrl/chatPath/model when provided', async () => {
    let url = '';
    const p = new OpenAiCompatShotPlanProvider({
      apiKey: KEY,
      baseUrl: 'https://api.kie.ai/',
      chatPath: '/api/v1/gemini-3-flash/v1/chat/completions',
      model: 'gemini-3-flash',
      fetchImpl: okFetch(completion(GOOD_LLM_PLAN), (u) => {
        url = u;
      }),
    });
    await p.draftPlan({ sku: 'X' });
    expect(url).toBe('https://api.kie.ai/api/v1/gemini-3-flash/v1/chat/completions');
  });

  it('includePackage adds an 8th PACKAGE brief', async () => {
    const p = new OpenAiCompatShotPlanProvider({
      apiKey: KEY,
      fetchImpl: okFetch(completion(GOOD_LLM_PLAN)),
    });
    const result = await p.draftPlan({ sku: 'X', includePackage: true });
    expect(result.briefs).toHaveLength(8);
    expect(result.briefs[7]?.slot).toBe('PACKAGE');
    expect(result.briefs[7]?.qaPolicy).toBe('amazon-package-us-v1');
  });

  it('maps HTTP errors to PlannerErrorClass', async () => {
    const cases: Array<[number, string]> = [
      [401, 'AUTH'],
      [403, 'AUTH'],
      [400, 'VALIDATION'],
      [429, 'RATE_LIMIT'],
      [500, 'TRANSIENT'],
      [502, 'TRANSIENT'],
      [418, 'UNKNOWN'],
    ];
    for (const [status, klass] of cases) {
      const p = new OpenAiCompatShotPlanProvider({
        apiKey: KEY,
        fetchImpl: (async () => new Response('err', { status })) as typeof fetch,
      });
      await expect(p.draftPlan({ sku: 'X' })).rejects.toMatchObject({ errorClass: klass });
    }
  });

  it('maps network failure to TRANSIENT and abort to TIMEOUT', async () => {
    const netFail = new OpenAiCompatShotPlanProvider({
      apiKey: KEY,
      fetchImpl: (async () => {
        throw new Error('socket hangup');
      }) as typeof fetch,
    });
    await expect(netFail.draftPlan({ sku: 'X' })).rejects.toMatchObject({
      errorClass: 'TRANSIENT',
    });

    const aborted = new OpenAiCompatShotPlanProvider({
      apiKey: KEY,
      fetchImpl: (async () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }) as typeof fetch,
    });
    await expect(aborted.draftPlan({ sku: 'X' })).rejects.toMatchObject({
      errorClass: 'TIMEOUT',
    });
  });

  it('rejects empty content / bad JSON / schema violations as VALIDATION', async () => {
    const empty = new OpenAiCompatShotPlanProvider({
      apiKey: KEY,
      fetchImpl: okFetch({ choices: [{ message: { content: '' } }] }),
    });
    await expect(empty.draftPlan({ sku: 'X' })).rejects.toMatchObject({
      errorClass: 'VALIDATION',
    });

    const badJson = new OpenAiCompatShotPlanProvider({
      apiKey: KEY,
      fetchImpl: okFetch(completion('not json at all')),
    });
    await expect(badJson.draftPlan({ sku: 'X' })).rejects.toMatchObject({
      errorClass: 'VALIDATION',
    });

    const badSchema = new OpenAiCompatShotPlanProvider({
      apiKey: KEY,
      fetchImpl: okFetch(completion(JSON.stringify({ briefs: [{ orderIndex: 1 }] }))),
    });
    await expect(badSchema.draftPlan({ sku: 'X' })).rejects.toMatchObject({
      errorClass: 'VALIDATION',
    });
  });

  it('ignores LLM creative fields when slot does not match template slot', () => {
    const template = DEFAULT_SEVEN_IMAGE_TEMPLATE.slice(0, 1);
    const merged = mergeWithTemplate([...template], {
      briefs: [
        {
          orderIndex: 1,
          slot: 'FEATURE', // template slot is MAIN — mismatch
          purpose: 'hacked purpose',
          copy: [{ text: 'SALE 90%', source: 'llm' }],
          must: [],
          mustNot: [],
        },
      ],
    });
    expect(merged[0]?.purpose).toBe(template[0]?.purpose);
    expect(merged[0]?.copy).toEqual([]);
  });
});

describe('extractJsonObject', () => {
  it('tolerates markdown fences and stray prose', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Here you go: {"a":2} hope this helps')).toEqual({ a: 2 });
  });
  it('throws VALIDATION when no object present', () => {
    try {
      extractJsonObject('no json');
      expect.unreachable();
    } catch (e) {
      expect((e as PlannerProviderError).errorClass).toBe('VALIDATION');
    }
  });
});

describe('FakeShotPlanProvider intent weaving', () => {
  it('routes intent segments into FEATURE briefs deterministically', async () => {
    const p = new FakeShotPlanProvider();
    const result = await p.draftPlan({
      sku: 'MUG-BLK-450',
      intent: '450ml 大容量、18 小时保温；办公桌面场景',
    });
    const features = result.briefs.filter((b) => b.slot === 'FEATURE');
    expect(features[0]?.copy[0]).toEqual({ text: '450ml 大容量', source: 'intent' });
    expect(features[0]?.purpose).toContain('450ml 大容量');
    expect(features[1]?.copy[0]).toEqual({ text: '18 小时保温', source: 'intent' });
    const lifestyle = result.briefs.find((b) => b.slot === 'LIFESTYLE');
    expect(lifestyle?.purpose).toContain('owner intent');
  });

  it('falls back to brand highlight copy without intent', async () => {
    const p = new FakeShotPlanProvider();
    const result = await p.draftPlan({
      sku: 'MUG-BLK-450',
      confirmedFacts: [{ key: 'brand', value: 'Acme' }],
    });
    const features = result.briefs.filter((b) => b.slot === 'FEATURE');
    expect(features[0]?.copy[0]?.text).toBe('Acme highlight');
  });
});
