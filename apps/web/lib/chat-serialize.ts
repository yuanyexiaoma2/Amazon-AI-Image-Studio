import type { ChatRepository } from '@studio/db';
import type { ChatMessageContent } from '@studio/db';

type ChatSessionRow = NonNullable<Awaited<ReturnType<ChatRepository['getSession']>>>;
type ChatMessageRow = Awaited<ReturnType<ChatRepository['appendMessage']>>;

function asBudgetLimit(json: unknown): { currency: string; amount: number } | null {
  if (
    json &&
    typeof json === 'object' &&
    typeof (json as { amount?: unknown }).amount === 'number'
  ) {
    const j = json as { currency?: unknown; amount: number };
    return { currency: typeof j.currency === 'string' ? j.currency : 'USD', amount: j.amount };
  }
  return null;
}

/** Serialize a chat_sessions row to the contracts ChatSession shape. */
export function serializeChatSession(session: ChatSessionRow) {
  return {
    id: session.id,
    projectId: session.projectId,
    workflowId: session.workflowId,
    title: session.title,
    budgetLimit: asBudgetLimit(session.budgetLimitJson),
    spentMicrounits: Number(session.spentMicrounits),
    createdByUserId: session.createdByUserId,
    createdAt: session.createdAt.toISOString(),
  };
}

/** Serialize a chat_messages row to the contracts ChatMessage shape. */
export function serializeChatMessage(message: ChatMessageRow) {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.contentJson as unknown as ChatMessageContent,
    batchId: message.batchId,
    provider: message.provider,
    modelId: message.modelId,
    latencyMs: message.latencyMs,
    createdAt: message.createdAt.toISOString(),
  };
}
