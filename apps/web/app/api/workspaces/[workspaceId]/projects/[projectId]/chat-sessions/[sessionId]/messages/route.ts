import { NextResponse } from 'next/server';
import { PostChatMessageRequestSchema, makeApiError } from '@studio/contracts';
import { prisma, ChatRepository, WorkflowRepository } from '@studio/db';
import {
  ChatProviderError,
  kieChatCompletion,
  resolveChatProviderKind,
  KIE_DEFAULT_BASE_URL,
  type KieChatMessage,
} from '@studio/providers';
import { getOrCreateRequestId } from '@/lib/request-id';
import { paidGateResponse, requireWorkspaceRoles } from '@/lib/workspace-access';
import { serializeChatMessage } from '@/lib/chat-serialize';
import { resolveChatModel } from '@/lib/chat-models';
import { NODE_TYPE_ZH } from '@/lib/zh-labels';
import { WORKFLOW_WRITE_ROLES, type WorkflowGraph } from '@studio/domain';

type Ctx = {
  params: Promise<{ workspaceId: string; projectId: string; sessionId: string }>;
};

/** Compact text rendering of the current draft graph, as advisor context. */
function summarizeGraph(graph: WorkflowGraph): string {
  if (graph.nodes.length === 0) return '（空画布）';
  const nodes = graph.nodes
    .map((n) => {
      const cfg = n.config as Record<string, unknown> | undefined;
      const title = typeof cfg?.title === 'string' ? cfg.title : '';
      const prompt = typeof cfg?.prompt === 'string' ? cfg.prompt.slice(0, 60) : '';
      const typeZh = NODE_TYPE_ZH[n.type] ?? n.type;
      const extras = [title && `「${title}」`, prompt && `提示词：${prompt}`]
        .filter(Boolean)
        .join(' ');
      return `${typeZh}${extras ? ` ${extras}` : ''}`;
    })
    .join('\n');
  return nodes;
}

function buildAdvisorSystemPrompt(graphSummary: string): string {
  return [
    '你是「亚马逊产品图创意参谋」，服务于一个电商生图画布工具。你的职责只有两件：',
    '1. 优化提示词：把用户的粗略想法改写成高质量的文生图/图生图提示词',
    '2. 创意建议：场景方向、构图、光线、卖点视觉化',
    '',
    '规则：',
    '- 全程用中文交流；但输出的提示词正文用英文（生图模型对英文更稳定），并用 ``` 代码块包裹方便复制',
    '- 回答简洁，一次最多给 3 条可执行建议，不要长篇大论',
    '- 你不能操作画布；如果用户让你搭建或修改画布，告诉他可以双击空白建卡、从卡片边缘拖线连接',
    '- 建议尽量贴合下方当前画布的内容',
    '',
    '当前画布概况：',
    graphSummary,
  ].join('\n');
}

/** Fake 参谋（CHAT_PROVIDER=fake 或未配 key 时的演示回复）。 */
function fakeAdvisorReply(userText: string): string {
  return [
    `（演示参谋）收到：「${userText.slice(0, 80)}」。配置真实 LLM 后我会给出针对性建议。`,
    '',
    '先送你一条通用的亚马逊主图提示词模板：',
    '```',
    'Professional product photography of {产品}, centered on a clean white background, soft diffused studio lighting, sharp focus, high detail, e-commerce main image, 1:1',
    '```',
  ].join('\n');
}

/**
 * POST /workspaces/{ws}/projects/{pid}/chat-sessions/{sid}/messages — 创意参谋回合
 * （同步）。追加 USER 消息，调用所选 LLM 生成参谋回复，追加 ASSISTANT 消息。
 * 参谋不执行任何画布命令——只做提示词优化与创意建议。
 *
 * Provider transport failure semantics: the USER message stays persisted but
 * no ASSISTANT message is written; the error maps to 502 CHAT_AUTH_FAILED
 * (errorClass AUTH) or 503 CHAT_UNAVAILABLE (anything else).
 */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, projectId, sessionId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...WORKFLOW_WRITE_ROLES]);
  if (!access.ok) return access.response;
  // PR-6: every advisor turn calls the chat LLM provider — paid action in local mode.
  const paidGate = await paidGateResponse(requestId);
  if (paidGate) return paidGate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const parsed = PostChatMessageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid chat message payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const chat = new ChatRepository(prisma);
  const session = await chat.getSession(workspaceId, sessionId);
  if (!session || session.projectId !== projectId) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Chat session not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  const userMessage = await chat.appendMessage({
    workspaceId,
    sessionId,
    role: 'USER',
    content: { text: parsed.data.content },
    actorUserId: access.session.userId,
  });

  // ── context: graph summary + recent history ───────────────────────────────
  let graphSummary = '（本会话未绑定画布）';
  if (session.workflowId) {
    const workflows = new WorkflowRepository(prisma);
    const wf = await workflows.getWithDraft(workspaceId, session.workflowId);
    const draftGraph = wf?.draft ? workflows.parseGraph(wf.draft) : null;
    graphSummary = draftGraph ? summarizeGraph(draftGraph) : '（画布不存在或已删除）';
  }

  const history = await chat.getWithMessages(workspaceId, sessionId, { limit: 20 });
  const historyMessages: KieChatMessage[] = (history?.messages ?? [])
    .filter((m) => m.role !== 'SYSTEM')
    .map((m) => ({
      role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content:
        typeof (m.contentJson as { text?: unknown }).text === 'string'
          ? (m.contentJson as { text: string }).text
          : '',
    }));

  // ── advisor turn ──────────────────────────────────────────────────────────
  const modelSlug = resolveChatModel(parsed.data.model);
  let reply: string;
  let providerName: string;
  let latencyMs = 0;
  const started = Date.now();
  try {
    if (resolveChatProviderKind() === 'kie') {
      const apiKey = process.env.KIE_API_KEY?.trim();
      if (!apiKey) {
        throw new ChatProviderError('AUTH', 'KIE_API_KEY is required when CHAT_PROVIDER=kie');
      }
      const result = await kieChatCompletion({
        config: {
          apiKey,
          baseUrl: process.env.KIE_BASE_URL?.trim() || KIE_DEFAULT_BASE_URL,
          model: modelSlug,
        },
        messages: [
          { role: 'system', content: buildAdvisorSystemPrompt(graphSummary) },
          ...historyMessages,
        ],
        temperature: 0.8,
      });
      reply = result.text;
      latencyMs = result.latencyMs;
      providerName = 'kie-llm-advisor';
    } else {
      reply = fakeAdvisorReply(parsed.data.content);
      latencyMs = Date.now() - started;
      providerName = 'fake-llm-advisor';
    }
  } catch (err) {
    if (err instanceof ChatProviderError) {
      const isAuth = err.errorClass === 'AUTH';
      return NextResponse.json(
        makeApiError(
          isAuth ? 'CHAT_AUTH_FAILED' : 'CHAT_UNAVAILABLE',
          err.message,
          requestId,
          { errorClass: err.errorClass },
        ),
        { status: isAuth ? 502 : 503, headers: { 'x-request-id': requestId } },
      );
    }
    throw err;
  }

  // ── persist the assistant turn ────────────────────────────────────────────
  const assistantMessage = await chat.appendMessage({
    workspaceId,
    sessionId,
    role: 'ASSISTANT',
    content: { text: reply },
    batchId: null,
    provider: providerName,
    modelId: modelSlug,
    latencyMs,
    actorUserId: access.session.userId,
  });

  return NextResponse.json(
    {
      userMessage: serializeChatMessage(userMessage),
      assistantMessage: serializeChatMessage(assistantMessage),
    },
    { status: 200, headers: { 'x-request-id': requestId } },
  );
}
