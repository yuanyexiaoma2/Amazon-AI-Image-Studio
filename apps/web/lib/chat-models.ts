/**
 * 创意参谋可切换的 LLM 清单（kie.ai Market 聊天模型，OpenAI 兼容端点）。
 * 前端下拉与 messages route 白名单共用这一份，防止客户端传任意 slug。
 * 可用环境变量 CHAT_MODELS 覆盖，格式：slug:中文名,slug2:中文名2
 * （kie 官方文档当前只列出 Gemini 系聊天模型；接入他家时在此追加即可）。
 */

export type ChatModelOption = {
  /** kie slug，同时也是请求路径段，如 gemini-3-flash。 */
  slug: string;
  label: string;
  desc: string;
};

const DEFAULT_CHAT_MODELS: ChatModelOption[] = [
  { slug: 'gemini-3-flash', label: 'Gemini 3 Flash', desc: '快速 · 默认' },
  { slug: 'gemini-3-1-pro', label: 'Gemini 3.1 Pro', desc: '深度推理 · 较慢' },
  { slug: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', desc: '文案细腻' },
  { slug: 'gpt-5-2', label: 'GPT-5.2', desc: '通用强' },
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
  const models = listChatModels(env);
  if (requested && models.some((m) => m.slug === requested)) return requested;
  return models[0]?.slug ?? DEFAULT_CHAT_MODEL;
}
