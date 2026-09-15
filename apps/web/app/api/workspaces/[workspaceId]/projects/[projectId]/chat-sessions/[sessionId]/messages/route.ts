import { NextResponse } from 'next/server';
import {
  AgentTurnOutputSchema,
  PostChatMessageRequestSchema,
  makeApiError,
  type WorkflowCommand,
} from '@studio/contracts';
import {
  amountToMicrounits,
  listEnabledModels,
  microunitsToAmount,
  resolveModelRegistry,
  WORKFLOW_WRITE_ROLES,
  type WorkflowGraph,
} from '@studio/domain';
import {
  prisma,
  newId,
  AssetRepository,
  ChatRepository,
  WorkflowRepository,
} from '@studio/db';
import {
  ChatProviderError,
  createChatAgentProvider,
  type ChatAgentMessage,
  type ChatAgentTurnOutput,
} from '@studio/providers';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { applyCommandsToWorkflow } from '@/lib/apply-commands';
import { serializeChatMessage } from '@/lib/chat-serialize';

type Ctx = {
  params: Promise<{ workspaceId: string; projectId: string; sessionId: string }>;
};

type RunCommand = Extract<WorkflowCommand, { type: 'run' }>;

/** Compact text rendering of the current draft graph for the agent prompt. */
function summarizeGraph(graph: WorkflowGraph): string {
  if (graph.nodes.length === 0) return '（空画布）';
  const nodes = graph.nodes.map((n) => `节点 ${n.id} (type=${n.type})`).join('\n');
  const edges =
    graph.edges.length > 0
      ? graph.edges.map((e) => `边 ${e.source}→${e.target}`).join('\n')
      : '（无连线）';
  return `${nodes}\n${edges}`;
}

async function buildCatalog(workspaceId: string, projectId: string): Promise<string> {
  const assets = new AssetRepository(prisma);
  const assetRows = (await assets.listByProject(workspaceId, projectId)).slice(0, 20);
  const assetLines = assetRows.map(
    (a) =>
      `素材 ${a.id} "${a.originalFilename ?? '(未命名)'}" (currentVersionId=${a.currentVersionId ?? '无'})`,
  );
  const models = listEnabledModels(resolveModelRegistry(process.env.IMAGE_PROVIDER));
  const modelLines = models.map((m) => `模型 ${m.key}: ${m.displayName}`);
  return [
    assetLines.length > 0 ? assetLines.join('\n') : '（项目暂无素材）',
    modelLines.join('\n'),
  ].join('\n');
}

/**
 * POST /workspaces/{ws}/projects/{pid}/chat-sessions/{sid}/messages — V2 PR-4
 * agent turn (synchronous). Appends the USER message, runs the chat agent
 * provider, validates the turn output against contracts AgentTurnOutputSchema,
 * applies the session budget gate to any run command, executes surviving
 * commands through lib/apply-commands as one undoable batch, accumulates the
 * run's estimateMicrounits into the session spend, and appends the ASSISTANT
 * message.
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

  // ── context: graph summary + catalog + recent history ─────────────────────
  const workflows = new WorkflowRepository(prisma);
  let graphSummary: string;
  if (!session.workflowId) {
    graphSummary = '（本会话未绑定画布）';
  } else {
    const wf = await workflows.getWithDraft(workspaceId, session.workflowId);
    graphSummary = wf?.draft ? summarizeGraph(workflows.parseGraph(wf.draft)) : '（画布不存在或已删除）';
  }
  const catalog = await buildCatalog(workspaceId, projectId);

  const history = await chat.getWithMessages(workspaceId, sessionId, { limit: 20 });
  const messages: ChatAgentMessage[] = (history?.messages ?? [])
    .filter((m) => m.role !== 'SYSTEM')
    .map((m) => ({
      role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
      text:
        typeof (m.contentJson as { text?: unknown }).text === 'string'
          ? ((m.contentJson as { text: string }).text)
          : '',
    }));

  // ── agent turn ────────────────────────────────────────────────────────────
  const turnNonce = newId();
  let turn: ChatAgentTurnOutput;
  try {
    turn = await createChatAgentProvider().runTurn({
      messages,
      graphSummary,
      catalog,
      turnNonce,
    });
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

  // Double-check against the contracts schema (single source of truth); on
  // failure degrade to a text-only reply instead of failing the turn.
  let reply = turn.reply;
  let commands: WorkflowCommand[] = [];
  let degraded = turn.meta.degraded === true;
  const validated = AgentTurnOutputSchema.safeParse({ reply: turn.reply, commands: turn.commands });
  if (validated.success) {
    commands = validated.data.commands;
  } else {
    reply = `（模型输出未通过校验，已忽略画布命令。原始回复：${turn.reply.slice(0, 200)}）`;
    degraded = true;
  }

  // Normalize run placement: the command layer requires at most one run as the
  // last command — move the first run to the tail and drop any extra runs.
  const runIndexes = commands.map((c, i) => (c.type === 'run' ? i : -1)).filter((i) => i >= 0);
  if (runIndexes.length > 0) {
    const wasSingleTailRun = runIndexes.length === 1 && runIndexes[0] === commands.length - 1;
    const firstRun = runIndexes[0] as number;
    const runCommand = commands[firstRun] as RunCommand;
    commands = commands.filter((_, i) => !runIndexes.includes(i));
    commands.push(runCommand);
    if (!wasSingleTailRun) {
      degraded = true;
    }
  }

  // ── session budget gate (only when the turn wants to run) ─────────────────
  let budgetRejected = false;
  const runIdx = commands.findIndex((c) => c.type === 'run');
  if (runIdx >= 0) {
    const budget = await chat.getBudgetState(workspaceId, sessionId);
    const limitMicrounits = budget?.budgetLimit
      ? amountToMicrounits(budget.budgetLimit.amount)
      : null;
    const remainingMicrounits =
      limitMicrounits !== null ? limitMicrounits - (budget?.spentMicrounits ?? 0) : null;
    if (remainingMicrounits === null || remainingMicrounits <= 0) {
      commands = commands.filter((_, i) => i !== runIdx);
      reply += '\n（本轮会话预算不足或未设置预算，未执行运行；其余画布命令已照常应用。）';
      budgetRejected = true;
    } else {
      // Never trust the LLM's key/limit: derive both server-side.
      commands[runIdx] = {
        ...(commands[runIdx] as RunCommand),
        budgetLimit: {
          currency: budget?.budgetLimit?.currency ?? 'USD',
          amount: microunitsToAmount(remainingMicrounits),
        },
        confirmBudget: true,
        idempotencyKey: `chat-run-${turnNonce}`,
      };
    }
  }

  // ── execute surviving commands as one undoable batch ──────────────────────
  let batchId: string | null = null;
  let run: unknown;
  let errorDetails: { status: number; code: string; message: string; details?: unknown } | null =
    null;
  if (commands.length > 0) {
    if (!session.workflowId) {
      reply += '\n（本会话未绑定画布，画布命令未执行。请先在绑定 workflow 的会话中操作。）';
      degraded = true;
      commands = [];
    } else {
      batchId = newId();
      const outcome = await applyCommandsToWorkflow({
        workspaceId,
        workflowId: session.workflowId,
        batchId,
        actorUserId: access.session.userId,
        commands,
        requestId,
      });
      if (!outcome.ok) {
        const apiErr = outcome.body.error;
        errorDetails = {
          status: outcome.status,
          code: apiErr.code,
          message: apiErr.message,
          details: apiErr.details,
        };
        const applied =
          apiErr.details !== null &&
          typeof apiErr.details === 'object' &&
          (apiErr.details as { commandsApplied?: unknown }).commandsApplied === true;
        reply += `\n（画布命令执行失败：${apiErr.code} — ${apiErr.message}${applied ? '；注意：图命令已应用并推进了草稿版本，仅运行创建失败' : ''}）`;
        const detailsBatchId =
          apiErr.details !== null && typeof apiErr.details === 'object'
            ? (apiErr.details as { batchId?: unknown }).batchId
            : undefined;
        if (typeof detailsBatchId !== 'string') {
          batchId = null;
        }
      } else {
        run = outcome.body.run;
        if (run && typeof (run as { estimateMicrounits?: unknown }).estimateMicrounits === 'number') {
          await chat.addSpentMicrounits(
            workspaceId,
            sessionId,
            (run as { estimateMicrounits: number }).estimateMicrounits,
          );
        }
      }
    }
  }

  // ── persist the assistant turn ────────────────────────────────────────────
  const commandsSummary =
    commands.length > 0 || degraded
      ? {
          count: commands.length,
          types: commands.map((c) => c.type),
          ...(degraded ? { degraded: true } : {}),
        }
      : undefined;
  const assistantMessage = await chat.appendMessage({
    workspaceId,
    sessionId,
    role: 'ASSISTANT',
    content: {
      text: reply,
      ...(commandsSummary ? { commandsSummary } : {}),
      ...(budgetRejected ? { budgetRejected: true } : {}),
      ...(errorDetails ? { error: errorDetails } : {}),
    },
    batchId,
    provider: turn.meta.provider,
    modelId: turn.meta.model ?? null,
    latencyMs: turn.meta.latencyMs,
    actorUserId: access.session.userId,
  });

  return NextResponse.json(
    {
      userMessage: serializeChatMessage(userMessage),
      assistantMessage: serializeChatMessage(assistantMessage),
      ...(batchId ? { batchId } : {}),
      ...(run !== undefined ? { run } : {}),
      ...(budgetRejected ? { budgetRejected: true } : {}),
    },
    { status: 200, headers: { 'x-request-id': requestId } },
  );
}
