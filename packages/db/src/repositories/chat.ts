import type { ChatMessage, ChatMessageRole, ChatSession, Prisma, PrismaClient } from '@prisma/client';
import { newId } from '../ids.js';

export class ChatNotFoundError extends Error {
  constructor(message = 'Chat resource not found') {
    super(message);
    this.name = 'ChatNotFoundError';
  }
}

export type ChatSessionBudgetLimit = { currency: string; amount: number };

export type ChatMessageContent = {
  text: string;
  commandsSummary?: { count: number; types: string[]; degraded?: boolean };
  [key: string]: unknown;
};

export type CreateChatSessionInput = {
  workspaceId: string;
  projectId: string;
  workflowId?: string | null;
  title?: string | null;
  budgetLimit?: ChatSessionBudgetLimit | null;
  createdByUserId: string;
};

export type AppendChatMessageInput = {
  workspaceId: string;
  sessionId: string;
  role: ChatMessageRole;
  content: ChatMessageContent;
  batchId?: string | null;
  provider?: string | null;
  modelId?: string | null;
  latencyMs?: number | null;
  /** Audit actor (who triggered the turn); falls back to session creator. */
  actorUserId?: string | null;
  /** Audit metadata; defaults to content.commandsSummary?.count. */
  commandsCount?: number;
};

export type ChatBudgetState = {
  budgetLimit: ChatSessionBudgetLimit | null;
  spentMicrounits: number;
};

type LockedSessionRow = {
  id: string;
  spent_microunits: bigint;
  budget_limit_json: unknown;
};

function asBudgetLimit(json: unknown): ChatSessionBudgetLimit | null {
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

export class ChatRepository {
  constructor(private readonly db: PrismaClient) {}

  async createSession(input: CreateChatSessionInput): Promise<ChatSession> {
    const project = await this.db.project.findFirst({
      where: { id: input.projectId, workspaceId: input.workspaceId, deletedAt: null },
    });
    if (!project) {
      throw new ChatNotFoundError('Project not found');
    }

    return this.db.$transaction(async (tx) => {
      const session = await tx.chatSession.create({
        data: {
          id: newId(),
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          workflowId: input.workflowId ?? null,
          title: input.title ?? null,
          budgetLimitJson: (input.budgetLimit ?? null) as Prisma.InputJsonValue,
          createdByUserId: input.createdByUserId,
        },
      });
      await tx.auditEvent.create({
        data: {
          id: newId(),
          workspaceId: input.workspaceId,
          actorUserId: input.createdByUserId,
          action: 'chat.session_created',
          subjectType: 'chat_session',
          subjectId: session.id,
          metadataJson: {
            projectId: input.projectId,
            workflowId: input.workflowId ?? null,
            title: input.title ?? null,
            budgetLimit: (input.budgetLimit ?? null) as Prisma.InputJsonValue,
          },
        },
      });
      return session;
    });
  }

  async listSessions(
    workspaceId: string,
    projectId: string,
    options: { workflowId?: string } = {},
  ): Promise<ChatSession[]> {
    return this.db.chatSession.findMany({
      where: {
        workspaceId,
        projectId,
        deletedAt: null,
        ...(options.workflowId ? { workflowId: options.workflowId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSession(workspaceId: string, sessionId: string): Promise<ChatSession | null> {
    return this.db.chatSession.findFirst({
      where: { id: sessionId, workspaceId, deletedAt: null },
    });
  }

  /** Rename a session (auto-title from first message, or manual rename). */
  async renameSession(
    workspaceId: string,
    sessionId: string,
    title: string,
  ): Promise<ChatSession | null> {
    const existing = await this.getSession(workspaceId, sessionId);
    if (!existing) return null;
    return this.db.chatSession.update({ where: { id: existing.id }, data: { title } });
  }

  /** Session + newest messages (createdAt asc, capped at `limit`, default 50). */
  async getWithMessages(
    workspaceId: string,
    sessionId: string,
    options: { limit?: number } = {},
  ): Promise<(ChatSession & { messages: ChatMessage[] }) | null> {
    const session = await this.getSession(workspaceId, sessionId);
    if (!session) return null;
    const limit = options.limit ?? 50;
    const rows = await this.db.chatMessage.findMany({
      where: { workspaceId, sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    rows.reverse();
    return { ...session, messages: rows };
  }

  /**
   * Append an immutable message. Assistant messages additionally write a
   * `chat.turn_applied` audit event in the same transaction, carrying the
   * command batchId + commandsCount (param override, else content summary).
   */
  async appendMessage(input: AppendChatMessageInput): Promise<ChatMessage> {
    return this.db.$transaction(async (tx) => {
      const message = await tx.chatMessage.create({
        data: {
          id: newId(),
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          role: input.role,
          contentJson: input.content as Prisma.InputJsonValue,
          batchId: input.batchId ?? null,
          provider: input.provider ?? null,
          modelId: input.modelId ?? null,
          latencyMs: input.latencyMs ?? null,
        },
      });

      if (input.role === 'ASSISTANT') {
        const commandsCount =
          input.commandsCount ?? input.content.commandsSummary?.count ?? 0;
        await tx.auditEvent.create({
          data: {
            id: newId(),
            workspaceId: input.workspaceId,
            actorUserId: input.actorUserId ?? null,
            action: 'chat.turn_applied',
            subjectType: 'chat_session',
            subjectId: input.sessionId,
            metadataJson: {
              messageId: message.id,
              batchId: input.batchId ?? null,
              commandsCount,
              provider: input.provider ?? null,
              modelId: input.modelId ?? null,
            },
          },
        });
      }

      return message;
    });
  }

  /**
   * Accumulate spentMicrounits under a row lock (SELECT ... FOR UPDATE) so
   * concurrent turns cannot lose updates. Returns the new total (number).
   */
  async addSpentMicrounits(
    workspaceId: string,
    sessionId: string,
    delta: number,
  ): Promise<number> {
    if (!Number.isFinite(delta) || delta < 0) {
      throw new Error('delta must be a non-negative finite number');
    }
    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedSessionRow[]>`
        SELECT id, spent_microunits
        FROM chat_sessions
        WHERE id = ${sessionId}::uuid AND workspace_id = ${workspaceId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      const row = locked[0];
      if (!row) {
        throw new ChatNotFoundError('Chat session not found');
      }
      const next = row.spent_microunits + BigInt(Math.trunc(delta));
      await tx.chatSession.update({
        where: { id: row.id },
        data: { spentMicrounits: next },
      });
      return Number(next);
    });
  }

  /** Budget-gate input: the session's limit + current accumulated spend. */
  async getBudgetState(workspaceId: string, sessionId: string): Promise<ChatBudgetState | null> {
    const session = await this.db.chatSession.findFirst({
      where: { id: sessionId, workspaceId, deletedAt: null },
      select: { budgetLimitJson: true, spentMicrounits: true },
    });
    if (!session) return null;
    return {
      budgetLimit: asBudgetLimit(session.budgetLimitJson),
      spentMicrounits: Number(session.spentMicrounits),
    };
  }
}
