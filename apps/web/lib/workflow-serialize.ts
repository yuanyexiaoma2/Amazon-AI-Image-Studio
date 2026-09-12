import type { WorkflowGraph } from '@studio/domain';

export function serializeWorkflowDraft(args: {
  workflowId: string;
  projectId: string;
  name: string;
  currentRevisionId: string | null;
  revisionNumber: number;
  graph: WorkflowGraph;
  updatedAt: Date;
  updatedByUserId: string | null;
}) {
  return {
    workflowId: args.workflowId,
    projectId: args.projectId,
    name: args.name,
    revisionNumber: args.revisionNumber,
    currentRevisionId: args.currentRevisionId,
    graph: args.graph,
    updatedAt: args.updatedAt.toISOString(),
    updatedByUserId: args.updatedByUserId,
  };
}
