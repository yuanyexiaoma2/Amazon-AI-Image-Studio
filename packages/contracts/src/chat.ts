import { z } from 'zod';
import { BudgetLimitSchema, GenerationRunSchema } from './generation.js';
import { WorkflowCommandSchema } from './workflow-commands.js';

/**
 * V2 PR-4 — chat agent sessions/messages.
 * A chat session is bound to a project (optionally a workflow) and carries an
 * optional per-session budget limit; spentMicrounits accumulates the estimated
 * cost of agent-triggered runs. spentMicrounits is serialized as a number,
 * consistent with the W4 credits/run precedent (CreditRepository converts
 * BigInt → Number before crossing the API boundary).
 */

export const ChatMessageRoleSchema = z.enum(['USER', 'ASSISTANT', 'SYSTEM']);

/** Stored in chat_messages.content_json — loose but structured. */
export const ChatMessageContentSchema = z
  .object({
    text: z.string(),
    /** Present on assistant turns that carried canvas commands. */
    commandsSummary: z
      .object({
        count: z.number().int().nonnegative(),
        types: z.array(z.string()),
        degraded: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

export const ChatSessionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  workflowId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  budgetLimit: BudgetLimitSchema.nullable(),
  spentMicrounits: z.number().int().nonnegative(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string(),
});

export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: ChatMessageRoleSchema,
  content: ChatMessageContentSchema,
  batchId: z.string().uuid().nullable(),
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const CreateChatSessionRequestSchema = z.object({
  workflowId: z.string().uuid().optional(),
  title: z.string().min(1).max(128).optional(),
  budgetLimit: BudgetLimitSchema.optional(),
});

export type CreateChatSessionRequest = z.infer<typeof CreateChatSessionRequestSchema>;

export const PatchChatSessionRequestSchema = z.object({
  title: z.string().min(1).max(128),
});

export type PatchChatSessionRequest = z.infer<typeof PatchChatSessionRequestSchema>;

export const PostChatMessageRequestSchema = z.object({
  content: z.string().min(1).max(4000),
  /** 参谋模式：可选的 LLM slug（服务端白名单校验，缺省用默认模型）。 */
  model: z.string().min(1).max(100).optional(),
});

export type PostChatMessageRequest = z.infer<typeof PostChatMessageRequestSchema>;

export const PostChatMessageResponseSchema = z.object({
  userMessage: ChatMessageSchema,
  assistantMessage: ChatMessageSchema,
  batchId: z.string().uuid().nullable().optional(),
  run: GenerationRunSchema.optional(),
  /** True when the session budget rejected the run command (graph commands still applied). */
  budgetRejected: z.boolean().optional(),
});

export type PostChatMessageResponse = z.infer<typeof PostChatMessageResponseSchema>;

/** One agent turn: text reply + at most 20 canvas commands. */
export const AgentTurnOutputSchema = z.object({
  reply: z.string(),
  commands: z.array(WorkflowCommandSchema).max(20),
});

export type AgentTurnOutput = z.infer<typeof AgentTurnOutputSchema>;
