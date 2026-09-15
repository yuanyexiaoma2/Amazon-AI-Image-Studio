import { z } from 'zod';
import { BudgetLimitSchema, GenerationRunSchema, RunScopeSchema } from './generation.js';
import { WorkflowGraphSchema } from './workflow.js';

/**
 * V2 PR-2 — canvas command layer.
 * All canvas mutations go through ordered command batches; nodeType/config
 * semantics are enforced by the domain layer against the node registry.
 */

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const NodeIdSchema = z.string().min(1).max(128);

export const AddNodeCommandSchema = z.object({
  type: z.literal('addNode'),
  /** Registry node type (validated in domain, not here). */
  nodeType: z.string().min(1).max(64),
  /** Optional explicit id; server generates one when omitted. */
  nodeId: NodeIdSchema.optional(),
  position: PositionSchema,
  /** Defaults to the node type's default config when omitted. */
  config: z.record(z.unknown()).optional(),
});

export const RemoveNodeCommandSchema = z.object({
  type: z.literal('removeNode'),
  nodeId: NodeIdSchema,
});

export const ConnectCommandSchema = z.object({
  type: z.literal('connect'),
  edgeId: z.string().min(1).max(128).optional(),
  source: NodeIdSchema,
  sourceHandle: z.string().max(64).nullable().optional(),
  target: NodeIdSchema,
  targetHandle: z.string().max(64).nullable().optional(),
});

export const DisconnectCommandSchema = z.object({
  type: z.literal('disconnect'),
  edgeId: z.string().min(1).max(128),
});

export const ConfigureCommandSchema = z.object({
  type: z.literal('configure'),
  nodeId: NodeIdSchema,
  config: z.record(z.unknown()),
});

export const MoveNodeCommandSchema = z.object({
  type: z.literal('moveNode'),
  nodeId: NodeIdSchema,
  position: PositionSchema,
});

export const RenameCommandSchema = z.object({
  type: z.literal('rename'),
  name: z.string().min(1).max(128),
});

export const RunCommandSchema = z.object({
  type: z.literal('run'),
  scope: RunScopeSchema,
  idempotencyKey: z.string().uuid().or(z.string().min(8).max(128)),
  budgetLimit: BudgetLimitSchema.optional().nullable(),
  confirmBudget: z.boolean().optional().default(false),
  modelKey: z.string().optional(),
});

export const WorkflowCommandSchema = z.discriminatedUnion('type', [
  AddNodeCommandSchema,
  RemoveNodeCommandSchema,
  ConnectCommandSchema,
  DisconnectCommandSchema,
  ConfigureCommandSchema,
  MoveNodeCommandSchema,
  RenameCommandSchema,
  RunCommandSchema,
]);

export type WorkflowCommand = z.infer<typeof WorkflowCommandSchema>;

export const ApplyWorkflowCommandsRequestSchema = z
  .object({
    ifRevision: z.number().int().nonnegative(),
    batchId: z.string().uuid(),
    commands: z.array(WorkflowCommandSchema).min(1).max(50),
  })
  .superRefine((value, ctx) => {
    const runIndexes = value.commands
      .map((c, i) => (c.type === 'run' ? i : -1))
      .filter((i) => i >= 0);
    const firstRunIndex = runIndexes[0];
    if (runIndexes.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'run command may appear at most once per batch',
        path: ['commands'],
      });
    }
    if (firstRunIndex !== undefined && firstRunIndex !== value.commands.length - 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'run command must be the last command in the batch',
        path: ['commands', firstRunIndex],
      });
    }
  });

export type ApplyWorkflowCommandsRequest = z.infer<typeof ApplyWorkflowCommandsRequestSchema>;

export const ApplyWorkflowCommandsResponseSchema = z.object({
  batchId: z.string().uuid(),
  workflowId: z.string().uuid(),
  revisionNumber: z.number().int().nonnegative(),
  name: z.string(),
  graph: WorkflowGraphSchema,
  /** Present when the batch ended with a run command. */
  run: GenerationRunSchema.optional(),
});

export type ApplyWorkflowCommandsResponse = z.infer<typeof ApplyWorkflowCommandsResponseSchema>;

export const UndoWorkflowCommandsRequestSchema = z.object({
  ifRevision: z.number().int().nonnegative(),
  /** Defaults to the most recent non-undone batch when omitted. */
  batchId: z.string().uuid().optional(),
});

/** Redo shares the undo request shape. */
export const RedoWorkflowCommandsRequestSchema = UndoWorkflowCommandsRequestSchema;

export type UndoWorkflowCommandsRequest = z.infer<typeof UndoWorkflowCommandsRequestSchema>;
export type RedoWorkflowCommandsRequest = z.infer<typeof RedoWorkflowCommandsRequestSchema>;
