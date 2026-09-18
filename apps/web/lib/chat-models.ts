/**
 * 创意参谋可切换的 LLM 清单（kie.ai Market 聊天模型）。
 * 前端下拉与 messages route 白名单共用这一份，防止客户端传任意 slug。
 * 可用环境变量 CHAT_MODELS 覆盖，格式：slug:中文名,slug2:中文名2
 *
 * kie 同一模型有两种端点形态（2026-09 实测）：
 * - openai（默认）：POST /{slug}/v1/chat/completions，slug 带 -openai 后缀，
 *   如 gemini-3-8-flash-openai（裸 slug gemini-3-8-flash 是 Gemini 原生
 *   streamGenerateContent 端点，会 422 "The model is not supported"）。
 * - anthropic：POST /claude/v1/messages（Anthropic Messages 形态），
 *   model 字段用 claude-sonnet-4-6。
 */

export type ChatApiStyle = 'openai' | 'anthropic';

export type ChatModelOption = {
  /** kie 模型标识：openai 形态下同时是请求路径段。 */
  slug: string;
  label: string;
  desc: string;
  /** 端点形态，默认 openai。 */
  apiStyle?: ChatApiStyle;
};

const DEFAULT_CHAT_MODELS: ChatModelOption[] = [
  { slug: 'gemini-3-8-flash-openai', label: 'Gemini 3.8 Flash', desc: '快速 · 默认' },
  {
    slug: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    desc: '文案细腻',
    apiStyle: 'anthropic',
  },
];

export const DEFAULT_CHAT_MODEL = DEFAULT_CHAT_MODELS[0]!.slug;

function parseEnvModels(raw: string): ChatModelOption[] {
  const out: ChatModelOption[] = [];
  for (const part of raw.split(',')) {
    const [slug, label] = part.split(':').map((s) => s?.trim() ?? '');
    if (slug && /^[a-z0-9][a-z0-9._-]{0,60}$/i.test(slug)) {
      out.push({ slug, label: label || slug, desc: '' });
    }
  }
  return out;
}

export function listChatModels(env: NodeJS.ProcessEnv = process.env): ChatModelOption[] {
  const raw = env.CHAT_MODELS?.trim();
  if (raw) {
    const parsed = parseEnvModels(raw);
    if (parsed.length > 0) return parsed;
  }
  return DEFAULT_CHAT_MODELS;
}

/** 白名单校验：不在清单里的 slug 回落到默认模型。 */
export function resolveChatModel(requested: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return resolveChatModelOption(requested, env).slug;
}

/** 同 resolveChatModel，但返回完整选项（含 apiStyle）。 */
export function resolveChatModelOption(
  requested: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ChatModelOption {
  const models = listChatModels(env);
  if (requested) {
    const hit = models.find((m) => m.slug === requested);
    if (hit) return hit;
  }
  return models[0] ?? DEFAULT_CHAT_MODELS[0]!;
}
