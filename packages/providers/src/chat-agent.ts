/**
 * V2 PR-4 — chat agent provider: the LLM "third operator" of the canvas.
 *
 * The agent answers one turn with `{ reply, commands[] }`; commands are canvas
 * commands (same JSON shape as the PR-2 command layer's WorkflowCommandSchema)
 * executed by the API layer as one undoable batch. kie has no function
 * calling, so the LLM emits plain JSON (response_format json_object) which is
 * Zod-validated here; unparseable / invalid output DEGRADES to a text-only
 * reply (never throws, so the chat session survives). Transport-level failures
 * (AUTH / RATE_LIMIT / …) still throw ChatProviderError for the API layer to
 * map to HTTP codes.
 *
 * NOTE: @studio/providers intentionally does NOT depend on @studio/contracts;
 * ChatWorkflowCommandSchema below mirrors contracts' WorkflowCommandSchema
 * (packages/contracts/src/workflow-commands.ts) — keep them in sync.
 */

import { z } from 'zod';
import {
  ChatProviderError,
  KIE_DEFAULT_BASE_URL,
  KIE_DEFAULT_LLM_MODEL,
  extractJsonObject,
  kieChatCompletion,
  type KieChatConfig,
} from './kie-chat.js';

export type ChatAgentMessage = { role: 'user' | 'assistant'; text: string };

export type ChatAgentTurnInput = {
  /** Conversation history, oldest first; the last user message is the new one. */
  messages: ChatAgentMessage[];
  /** Compact text summary of the current workflow draft graph. */
  graphSummary: string;
  /** Available assets / model keys the agent may reference. */
  catalog: string;
  /**
   * Per-turn nonce. FakeChatAgentProvider folds it into run idempotency keys so
   * repeated "运行" turns never collide on the workspace idempotency unique key.
   */
  turnNonce?: string;
};

export type ChatAgentTurnOutput = {
  reply: string;
  /** Validated workflow commands (unknown[] at the type level; Zod-checked). */
  commands: unknown[];
  meta: {
    provider: string;
    model?: string;
    latencyMs: number;
    /** True when the LLM output failed parsing/validation and was replaced. */
    degraded?: boolean;
  };
};

export interface ChatAgentProvider {
  readonly name: string;
  runTurn(input: ChatAgentTurnInput): Promise<ChatAgentTurnOutput>;
}

// ─── Local mirror of contracts' WorkflowCommandSchema ───────────────────────

const PositionSchema = z.object({ x: z.number(), y: z.number() });
const NodeIdSchema = z.string().min(1).max(128);

const RunScopeSchema = z.object({
  type: z.enum(['ALL', 'BRANCH_FROM', 'NODES']).default('ALL'),
  nodeId: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
});

const BudgetLimitSchema = z.object({
  currency: z.string().min(1).default('USD'),
  amount: z.number().nonnegative(),
});

/** Mirrors packages/contracts/src/workflow-commands.ts (providers has no contracts dep). */
export const ChatWorkflowCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('addNode'),
    nodeType: z.string().min(1).max(64),
    nodeId: NodeIdSchema.optional(),
    position: PositionSchema,
    config: z.record(z.unknown()).optional(),
  }),
  z.object({ type: z.literal('removeNode'), nodeId: NodeIdSchema }),
  z.object({
    type: z.literal('connect'),
    edgeId: z.string().min(1).max(128).optional(),
    source: NodeIdSchema,
    sourceHandle: z.string().max(64).nullable().optional(),
    target: NodeIdSchema,
    targetHandle: z.string().max(64).nullable().optional(),
  }),
  z.object({ type: z.literal('disconnect'), edgeId: z.string().min(1).max(128) }),
  z.object({ type: z.literal('configure'), nodeId: NodeIdSchema, config: z.record(z.unknown()) }),
  z.object({ type: z.literal('moveNode'), nodeId: NodeIdSchema, position: PositionSchema }),
  z.object({ type: z.literal('rename'), name: z.string().min(1).max(128) }),
  z.object({
    type: z.literal('run'),
    scope: RunScopeSchema,
    idempotencyKey: z.string().uuid().or(z.string().min(8).max(128)),
    budgetLimit: BudgetLimitSchema.optional().nullable(),
    confirmBudget: z.boolean().optional().default(false),
    modelKey: z.string().optional(),
  }),
]);

/** Mirrors contracts' AgentTurnOutputSchema (chat.ts). */
export const ChatAgentTurnOutputSchema = z.object({
  reply: z.string(),
  commands: z.array(ChatWorkflowCommandSchema).max(20),
});

// ─── kie LLM chat agent ─────────────────────────────────────────────────────

export const CHAT_AGENT_SYSTEM_PROMPT = `你是一个电商图片工作流画布助手。用户用中文描述需求，你输出严格的 JSON（不要 markdown 代码块）：
{"reply": "给用户的中文回复", "commands": [画布命令...]}

commands 是可撤销的画布命令批次，按顺序执行，可选类型：
- {"type":"addNode","nodeType":"<类型>","nodeId":"<可选id>","position":{"x":0,"y":0},"config":{...}}
- {"type":"removeNode","nodeId":"..."}
- {"type":"connect","edgeId":"<可选id>","source":"<节点id>","sourceHandle":"image","target":"<节点id>","targetHandle":"image"}
- {"type":"disconnect","edgeId":"..."}
- {"type":"configure","nodeId":"...","config":{...}}
- {"type":"moveNode","nodeId":"...","position":{"x":0,"y":0}}
- {"type":"rename","name":"..."}
- {"type":"run","scope":{"type":"ALL"},"idempotencyKey":"<每次运行唯一的字符串>","confirmBudget":true}

规则：
- 只输出上述 JSON；纯聊天/解答时 commands 返回空数组。
- 一批最多 20 条命令；run 命令最多一条且必须是最后一条。
- 只能引用「当前画布」里存在的节点 id 与「可用资源/模型」里列出的素材和模型 key，不要编造。
- 常用节点类型：source_image（源图）、generate（生图）、prompt、remove_background、replace_background、inpaint、outpaint、upscale。`;

export type KieChatAgentConfig = KieChatConfig & {
  /** Provider label reported in meta, e.g. kie-llm-chat-agent. */
  providerName?: string;
};

export class KieChatAgentProvider implements ChatAgentProvider {
  readonly name: string;
  private readonly config: KieChatAgentConfig;

  constructor(config: KieChatAgentConfig) {
    if (!config.apiKey?.trim()) {
      throw new ChatProviderError('AUTH', 'An API key is required for a real chat agent provider');
    }
    this.config = { ...config, model: config.model || KIE_DEFAULT_LLM_MODEL };
    this.name = config.providerName ?? 'kie-llm-chat-agent';
  }

  async runTurn(input: ChatAgentTurnInput): Promise<ChatAgentTurnOutput> {
    const context = [
      `【当前画布】\n${input.graphSummary || '（空画布）'}`,
      '',
      `【可用资源/模型】\n${input.catalog || '（无）'}`,
    ].join('\n');

    const { text, latencyMs } = await kieChatCompletion({
      config: this.config,
      messages: [
        { role: 'system', content: CHAT_AGENT_SYSTEM_PROMPT },
        { role: 'user', content: context },
        { role: 'assistant', content: '{"reply":"收到，我会基于当前画布与可用资源回答。","commands":[]}' },
        ...input.messages.map((m) => ({ role: m.role, content: m.text })),
      ],
      temperature: 0.3,
      jsonMode: true,
    });

    const meta = { provider: this.name, model: this.config.model, latencyMs };

    let parsed: z.infer<typeof ChatAgentTurnOutputSchema>;
    try {
      const result = ChatAgentTurnOutputSchema.safeParse(extractJsonObject(text));
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .slice(0, 3)
          .join('; ');
        return {
          reply: `（模型返回的画布命令未通过校验：${issues}。未执行任何画布操作，请换个说法再试。）`,
          commands: [],
          meta: { ...meta, degraded: true },
        };
      }
      parsed = result.data;
    } catch (e) {
      const reason = e instanceof ChatProviderError ? e.message : (e as Error).message;
      return {
        reply: `（模型输出解析失败：${reason}。未执行任何画布操作，请换个说法再试。）`,
        commands: [],
        meta: { ...meta, degraded: true },
      };
    }

    return { reply: parsed.reply, commands: parsed.commands, meta };
  }
}

// ─── Fake deterministic chat agent (default, offline, e2e-friendly) ─────────

export type FakeChatAgentOptions = {
  /** Overrides run idempotency-key derivation (tests/e2e may inject their own). */
  idempotencyKeyFactory?: (input: ChatAgentTurnInput) => string;
};

/** FNV-1a 32-bit — stable key material when no turnNonce is provided. */
function stableHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class FakeChatAgentProvider implements ChatAgentProvider {
  readonly name = 'fake-chat-agent';
  private readonly idempotencyKeyFactory?: (input: ChatAgentTurnInput) => string;

  constructor(options: FakeChatAgentOptions = {}) {
    this.idempotencyKeyFactory = options.idempotencyKeyFactory;
  }

  runTurn(input: ChatAgentTurnInput): Promise<ChatAgentTurnOutput> {
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.text ?? '';
    const meta = { provider: this.name, latencyMs: 0 };

    if (/撤销/.test(text)) {
      return Promise.resolve({
        reply: '好的。撤销不走我这里的命令——请使用面板的「撤销本轮」按钮，它会按批次回滚上一轮画布变更。',
        commands: [],
        meta,
      });
    }

    if (/搭建|加节点|生成流程/.test(text)) {
      return Promise.resolve({
        reply: '已为你搭建基础生图流程：source_image（源图）→ generate（生图），并已连线。选中节点可在右侧配置参数。',
        commands: [
          {
            type: 'addNode',
            nodeType: 'source_image',
            nodeId: 'chat-src-1',
            position: { x: 0, y: 0 },
          },
          {
            type: 'addNode',
            nodeType: 'generate',
            nodeId: 'chat-gen-1',
            position: { x: 320, y: 0 },
          },
          {
            type: 'connect',
            edgeId: 'chat-edge-1',
            source: 'chat-src-1',
            sourceHandle: 'image',
            target: 'chat-gen-1',
            targetHandle: 'image',
          },
        ],
        meta,
      });
    }

    if (/运行|跑/.test(text)) {
      const idempotencyKey =
        this.idempotencyKeyFactory?.(input) ??
        `chat-run-${input.turnNonce ?? stableHash(JSON.stringify(input.messages))}`;
      return Promise.resolve({
        reply: '已提交整图运行（scope=ALL），请到任务面板查看进度。',
        commands: [
          {
            type: 'run',
            scope: { type: 'ALL' },
            idempotencyKey,
          },
        ],
        meta,
      });
    }

    return Promise.resolve({
      reply: `收到：「${text.slice(0, 120)}」。我可以帮你搭建流程（试试「搭建一个生图流程」）、运行画布（「运行」）。`,
      commands: [],
      meta,
    });
  }
}

// ─── factory ────────────────────────────────────────────────────────────────

export type ChatProviderKind = 'fake' | 'kie';

export function resolveChatProviderKind(env: NodeJS.ProcessEnv = process.env): ChatProviderKind {
  const raw = (env.CHAT_PROVIDER ?? 'fake').trim().toLowerCase();
  if (raw === 'kie' || raw === 'kie.ai' || raw === 'kieai') return 'kie';
  return 'fake';
}

export type CreateChatAgentProviderOptions = {
  env?: NodeJS.ProcessEnv;
  /** Test overrides for the kie chat HTTP layer. */
  kieOverrides?: Partial<KieChatAgentConfig>;
};

export function createChatAgentProvider(
  options: CreateChatAgentProviderOptions = {},
): ChatAgentProvider {
  const env = options.env ?? process.env;
  const kind = resolveChatProviderKind(env);
  if (kind === 'kie') {
    const apiKey = env.KIE_API_KEY?.trim();
    if (!apiKey) {
      throw new ChatProviderError('AUTH', 'KIE_API_KEY is required when CHAT_PROVIDER=kie');
    }
    return new KieChatAgentProvider({
      apiKey,
      baseUrl: env.KIE_BASE_URL?.trim() || KIE_DEFAULT_BASE_URL,
      chatPath: env.KIE_LLM_CHAT_PATH?.trim() || undefined,
      model: env.KIE_LLM_MODEL?.trim() || KIE_DEFAULT_LLM_MODEL,
      providerName: 'kie-llm-chat-agent',
      ...options.kieOverrides,
    });
  }
  return new FakeChatAgentProvider();
}
