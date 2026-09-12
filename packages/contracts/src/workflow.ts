import { z } from 'zod';

export const WorkflowGraphNodeSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.string().min(1).max(64),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  config: z.record(z.unknown()).optional().default({ schemaVersion: 1 }),
});

export const WorkflowGraphEdgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
  sourceHandle: z.string().max(64).nullable().optional(),
  targetHandle: z.string().max(64).nullable().optional(),
});

export const WorkflowGraphSchema = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(WorkflowGraphNodeSchema).max(500),
  edges: z.array(WorkflowGraphEdgeSchema).max(2000),
});

export const WorkflowDraftSchema = z.object({
  workflowId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  revisionNumber: z.number().int().nonnegative(),
  currentRevisionId: z.string().uuid().nullable(),
  graph: WorkflowGraphSchema,
  updatedAt: z.string().datetime(),
  updatedByUserId: z.string().uuid().nullable(),
});

export const CreateWorkflowRequestSchema = z.object({
  name: z.string().min(1).max(128).optional().default('Untitled workflow'),
});

export const PatchWorkflowRequestSchema = z.object({
  ifRevision: z.number().int().nonnegative(),
  graph: WorkflowGraphSchema,
  name: z.string().min(1).max(128).optional(),
});

export const SnapshotWorkflowRequestSchema = z.object({
  ifRevision: z.number().int().nonnegative(),
});

export const WorkflowRevisionSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  revision: z.number().int().positive(),
  graph: WorkflowGraphSchema,
  createdAt: z.string().datetime(),
  createdByUserId: z.string().uuid(),
});

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
export type PatchWorkflowRequest = z.infer<typeof PatchWorkflowRequestSchema>;
export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;
