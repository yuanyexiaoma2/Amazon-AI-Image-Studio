/**
 * Shared kie.ai LLM chat-completions client (V2).
 *
 * Single HTTP wrapper behind both the shot-plan planner and the chat agent:
 * - Endpoint shape: POST {baseUrl}/{model-slug}/v1/chat/completions — the model
 *   slug goes in the PATH (kie Market convention; the unified
 *   /api/v1/chat/completions returns "feature not supported" for LLMs).
 * - kie 200-envelope trap: HTTP 200 with body {code >= 400, msg} is an error.
 * - AbortController timeout; message content may be a string or an array of
 *   {type:'text', text} parts — both are accepted on the way out.
 * - Errors are normalized to ChatProviderError with an errorClass the API layer
 *   maps to HTTP codes.
 */

export type ChatErrorClass =
  | 'AUTH'
  | 'VALIDATION'
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'TIMEOUT'
  | 'UNKNOWN';

export class ChatProviderError extends Error {
  constructor(
    readonly errorClass: ChatErrorClass,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ChatProviderError';
  }
}

export type KieChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type KieChatConfig = {
  apiKey: string;
  /** Default https://api.kie.ai (no trailing slash). */
  baseUrl?: string;
  /** Model ID, e.g. gemini-3-flash (kie provider/model convention). */
  model: string;
  /** Chat completions path. Default derived from the model slug. */
  chatPath?: string;
  /**
   * 端点形态：openai（默认，/{slug}/v1/chat/completions）或
   * anthropic（/claude/v1/messages，Anthropic Messages 请求/响应结构）。
   */
  apiStyle?: 'openai' | 'anthropic';
  timeoutMs?: number;
  /** Test hook: inject a fetch implementation. */
  fetchImpl?: typeof fetch;
};

export const KIE_DEFAULT_BASE_URL = 'https://api.kie.ai';
export const KIE_DEFAULT_LLM_MODEL = 'gemini-3-flash';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * kie.ai LLM chat endpoint shape (docs.kie.ai/market/gemini/*):
 * POST {baseUrl}/{model-slug}/v1/chat/completions — model in the PATH.
 */
export function kieChatPathForModel(model: string): string {
  const slug = model.trim().replace(/^\/+|\/+$/g, '');
  return `/${slug}/v1/chat/completions`;
}

/** Anthropic Messages 形态的固定路径（kie 按 Claude 官方路径暴露）。 */
export const KIE_ANTHROPIC_MESSAGES_PATH = '/claude/v1/messages';

/** Extract the first JSON object from raw model text (tolerates stray prose/fences). */
export function extractJsonObject(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new ChatProviderError('VALIDATION', 'LLM returned no JSON object');
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    throw new ChatProviderError(
      'VALIDATION',
      `LLM returned unparseable JSON: ${(e as Error).message}`,
    );
  }
}

export function normalizeHttpError(status: number, bodyText: string): ChatProviderError {
  if (status === 401 || status === 403) {
    return new ChatProviderError('AUTH', `LLM auth failed (${status})`, status);
  }
  if (status === 429) {
    return new ChatProviderError('RATE_LIMIT', 'LLM rate limited (429)', status);
  }
  if (status === 400 || status === 404) {
    return new ChatProviderError(
      'VALIDATION',
      `LLM rejected request (${status}): ${bodyText.slice(0, 200)}`,
      status,
    );
  }
  if (status >= 500) {
    return new ChatProviderError('TRANSIENT', `LLM server error (${status})`, status);
  }
  return new ChatProviderError('UNKNOWN', `LLM unexpected status ${status}`, status);
}

export type KieChatCompletionInput = {
  config: KieChatConfig;
  messages: KieChatMessage[];
  temperature?: number;
  /** When true, sets response_format: { type: 'json_object' }. */
  jsonMode?: boolean;
};

export type KieChatCompletionResult = {
  text: string;
  latencyMs: number;
};

/** One OpenAI-compatible chat completion round-trip against kie (or compatible). */
export async function kieChatCompletion(
  input: KieChatCompletionInput,
): Promise<KieChatCompletionResult> {
  const { config } = input;
  const style = config.apiStyle ?? 'openai';
  const baseUrl = (config.baseUrl ?? KIE_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const chatPath =
    config.chatPath ??
    (style === 'anthropic' ? KIE_ANTHROPIC_MESSAGES_PATH : kieChatPathForModel(config.model));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = `${baseUrl}${chatPath}`;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(
        style === 'anthropic'
          ? toAnthropicBody(config.model, input)
          : {
              model: config.model,
              messages: input.messages.map((m) => ({
                role: m.role,
                content: [{ type: 'text', text: m.content }],
              })),
              temperature: input.temperature ?? 0.7,
              ...(input.jsonMode ? { response_format: { type: 'json_object' } } : {}),
              stream: false,
            },
      ),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new ChatProviderError('TIMEOUT', `LLM timed out after ${timeoutMs}ms`);
    }
    throw new ChatProviderError('TRANSIENT', `LLM network error: ${(e as Error).message}`);
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
    // Anthropic Messages shape
    content?: Array<{ type?: string; text?: string }>;
  };
  if (typeof payload.code === 'number' && payload.code >= 400) {
    throw normalizeHttpError(payload.code, payload.msg ?? '');
  }
  let text: string | undefined;
  if (style === 'anthropic') {
    text = (payload.content ?? [])
      .filter((p) => p.type === 'text' || typeof p.text === 'string')
      .map((p) => p.text ?? '')
      .join('');
  } else {
    const rawContent = payload.choices?.[0]?.message?.content;
    text = Array.isArray(rawContent)
      ? rawContent.map((p) => p.text ?? '').join('')
      : rawContent;
  }
  if (!text) {
    throw new ChatProviderError('VALIDATION', 'LLM returned empty content');
  }

  return { text, latencyMs: Date.now() - started };
}

/**
 * Anthropic Messages 请求体：system 消息提到顶层 system 字段，
 * messages 只留 user/assistant（Anthropic 不接受 system role），
 * max_tokens 必填。jsonMode 无对应参数，忽略。
 */
function toAnthropicBody(model: string, input: KieChatCompletionInput) {
  const system = input.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const messages = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  return {
    model,
    max_tokens: 4096,
    temperature: input.temperature ?? 0.7,
    ...(system ? { system } : {}),
    messages,
  };
}
