import type { PrismaClient, Workflow, WorkflowDraft, WorkflowRevision } from '@prisma/client';
import {
  emptyWorkflowGraph,
  propagateStaleFromGraphDiff,
  validateWorkflowGraph,
  type WorkflowGraph,
} from '@studio/domain';
import { newId } from '../ids.js';

export class WorkflowConflictError extends Error {
  readonly code = 'WORKFLOW_REVISION_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowConflictError';
  }
}

export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowNotFoundError';
  }
}

export type WorkflowWithDraft = Workflow & { draft: WorkflowDraft | null };

function asGraph(json: unknown): WorkflowGraph {
  if (
    json &&
    typeof json === 'object' &&
    'schemaVersion' in json &&
    'nodes' in json &&
    'edges' in json
  ) {
    return json as WorkflowGraph;
  }
  return emptyWorkflowGraph();
}

export class WorkflowRepository {
  constructor(private readonly db: PrismaClient) {}

  async listByProject(workspaceId: string, projectId: string): Promise<Workflow[]> {
    return this.db.workflow.findMany({
      where: { workspaceId, projectId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getWithDraft(workspaceId: string, workflowId: string): Promise<WorkflowWithDraft | null> {
    return this.db.workflow.findFirst({
      where: { id: workflowId, workspaceId, deletedAt: null },
      include: { draft: true },
    });
  }

  async createEmpty(args: {
    workspaceId: string;
    projectId: string;
    name: string;
    createdByUserId: string;
  }): Promise<WorkflowWithDraft> {
    const project = await this.db.project.findFirst({
      where: { id: args.projectId, workspaceId: args.workspaceId, deletedAt: null },
    });
    if (!project) {
      throw new WorkflowNotFoundError('Project not found');
    }

    const workflowId = newId();
    const draftId = newId();
    const graph = emptyWorkflowGraph();

    return this.db.$transaction(async (tx) => {
      const workflow = await tx.workflow.create({
        data: {
          id: workflowId,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          name: args.name,
        },
      });
      const draft = await tx.workflowDraft.create({
        data: {
          id: draftId,
          workspaceId: args.workspaceId,
          workflowId,
          graphJson: graph as object,
          revisionNumber: 0,
          updatedByUserId: args.createdByUserId,
        },
      });
      await tx.auditEvent.create({
        data: {
          id: newId(),
          workspaceId: args.workspaceId,
          actorUserId: args.createdByUserId,
          action: 'workflow.created',
          subjectType: 'workflow',
          subjectId: workflowId,
          metadataJson: { projectId: args.projectId, name: args.name },
        },
      });
      return { ...workflow, draft };
    });
  }

  /** Create workflow whose draft already contains a materialized graph (W3-08). */
  async createWithGraph(args: {
    workspaceId: string;
    projectId: string;
    name: string;
    createdByUserId: string;
    graph: WorkflowGraph;
  }): Promise<WorkflowWithDraft> {
    const validation = validateWorkflowGraph(args.graph);
    if (!validation.ok) {
      throw new WorkflowValidationError('Illegal workflow graph', validation.issues);
    }

    const project = await this.db.project.findFirst({
      where: { id: args.projectId, workspaceId: args.workspaceId, deletedAt: null },
    });
    if (!project) {
      throw new WorkflowNotFoundError('Project not found');
    }

    const workflowId = newId();
    const draftId = newId();

    return this.db.$transaction(async (tx) => {
      const workflow = await tx.workflow.create({
        data: {
          id: workflowId,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          name: args.name,
        },
      });
      const draft = await tx.workflowDraft.create({
        data: {
          id: draftId,
          workspaceId: args.workspaceId,
          workflowId,
          graphJson: args.graph as object,
          revisionNumber: 1,
          updatedByUserId: args.createdByUserId,
        },
      });
      await tx.auditEvent.create({
        data: {
          id: newId(),
          workspaceId: args.workspaceId,
          actorUserId: args.createdByUserId,
          action: 'workflow.materialized',
          subjectType: 'workflow',
          subjectId: workflowId,
          metadataJson: {
            projectId: args.projectId,
            name: args.name,
            nodeCount: args.graph.nodes.length,
            edgeCount: args.graph.edges.length,
          },
        },
      });
      return { ...workflow, draft };
    });
  }

  /**
   * Optimistic draft save: UPDATE ... WHERE revision_number = ifRevision;
   * affected row count must be 1, else 409 WORKFLOW_REVISION_CONFLICT.
   * Cyclic / illegal graphs are rejected (domain validateWorkflowGraph).
   */
  async saveDraft(args: {
    workspaceId: string;
    workflowId: string;
    ifRevision: number;
    graph: WorkflowGraph;
    updatedByUserId: string;
    name?: string;
  }): Promise<WorkflowWithDraft> {
    const validation = validateWorkflowGraph(args.graph);
    if (!validation.ok) {
      throw new WorkflowValidationError('Illegal workflow graph', validation.issues);
    }

    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM workflows
        WHERE id = ${args.workflowId}::uuid AND workspace_id = ${args.workspaceId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;

      const workflow = await tx.workflow.findFirst({
        where: { id: args.workflowId, workspaceId: args.workspaceId, deletedAt: null },
      });
      if (!workflow) {
        throw new WorkflowNotFoundError('Workflow not found');
      }

      const draftUpdate = await tx.workflowDraft.updateMany({
        where: {
          workspaceId: args.workspaceId,
          workflowId: args.workflowId,
          revisionNumber: args.ifRevision,
        },
        data: {
          graphJson: args.graph as object,
          revisionNumber: args.ifRevision + 1,
          updatedByUserId: args.updatedByUserId,
        },
      });
      if (draftUpdate.count !== 1) {
        throw new WorkflowConflictError(
          'WORKFLOW_REVISION_CONFLICT: draft conditional update affected 0 rows (stale ifRevision)',
        );
      }

      if (args.name !== undefined && args.name !== workflow.name) {
        const nameUpdate = await tx.workflow.updateMany({
          where: { id: args.workflowId, workspaceId: args.workspaceId },
          data: { name: args.name },
        });
        if (nameUpdate.count !== 1) {
          throw new WorkflowConflictError('Workflow name update conflict');
        }
      }

      await tx.auditEvent.create({
        data: {
          id: newId(),
          workspaceId: args.workspaceId,
          actorUserId: args.updatedByUserId,
          action: 'workflow.draft_saved',
          subjectType: 'workflow',
          subjectId: args.workflowId,
          metadataJson: {
            ifRevision: args.ifRevision,
            nextRevision: args.ifRevision + 1,
            nodeCount: args.graph.nodes.length,
            edgeCount: args.graph.edges.length,
          },
        },
      });

      const fresh = await tx.workflow.findFirst({
        where: { id: args.workflowId, workspaceId: args.workspaceId },
        include: { draft: true },
      });
      if (!fresh?.draft) {
        throw new WorkflowNotFoundError('Workflow draft missing after save');
      }
      return fresh;
    });
  }

  /** Create immutable WorkflowRevision from current draft (spec §8.4). */
  async snapshot(args: {
    workspaceId: string;
    workflowId: string;
    ifRevision: number;
    createdByUserId: string;
  }): Promise<{ workflow: WorkflowWithDraft; revision: WorkflowRevision }> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM workflows
        WHERE id = ${args.workflowId}::uuid AND workspace_id = ${args.workspaceId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;

      const workflow = await tx.workflow.findFirst({
        where: { id: args.workflowId, workspaceId: args.workspaceId, deletedAt: null },
        include: { draft: true },
      });
      if (!workflow?.draft) {
        throw new WorkflowNotFoundError('Workflow or draft not found');
      }
      if (workflow.draft.revisionNumber !== args.ifRevision) {
        throw new WorkflowConflictError(
          'WORKFLOW_REVISION_CONFLICT: snapshot ifRevision does not match draft',
        );
      }

      const graph = asGraph(workflow.draft.graphJson);
      const validation = validateWorkflowGraph(graph);
      if (!validation.ok) {
        throw new WorkflowValidationError('Cannot snapshot illegal workflow graph', validation.issues);
      }

      const last = await tx.workflowRevision.findFirst({
        where: { workspaceId: args.workspaceId, workflowId: args.workflowId },
        orderBy: { revision: 'desc' },
      });
      const nextRev = (last?.revision ?? 0) + 1;
      const revision = await tx.workflowRevision.create({
        data: {
          id: newId(),
          workspaceId: args.workspaceId,
          workflowId: args.workflowId,
          revision: nextRev,
          graphJson: graph as object,
          createdByUserId: args.createdByUserId,
        },
      });

      const wfUpdate = await tx.workflow.updateMany({
        where: { id: args.workflowId, workspaceId: args.workspaceId },
        data: { currentRevisionId: revision.id },
      });
      if (wfUpdate.count !== 1) {
        throw new WorkflowConflictError('Failed to advance workflow current_revision_id');
      }

      // W5-08: when graph drifts from prior revision, mark prior NodeResults STALE (keep outputs).
      if (last) {
        const prevGraph = asGraph(last.graphJson);
        const ev = propagateStaleFromGraphDiff(prevGraph, graph);
        if (ev.staleNodeIds.length > 0) {
          for (const nodeId of ev.staleNodeIds) {
            const existing = await tx.nodeResult.findUnique({
              where: {
                workspaceId_workflowRevisionId_nodeId: {
                  workspaceId: args.workspaceId,
                  workflowRevisionId: last.id,
                  nodeId,
                },
              },
            });
            if (existing && existing.status === 'SUCCEEDED') {
              await tx.nodeResult.update({
                where: { id: existing.id },
                data: {
                  status: 'STALE',
                  staleReason: ev.reason,
                  staleCause: ev.cause,
                },
              });
              if (existing.lastAttemptId) {
                await tx.generationOutput.updateMany({
                  where: {
                    workspaceId: args.workspaceId,
                    attemptId: existing.lastAttemptId,
                    disposition: 'CURRENT',
                  },
                  data: { disposition: 'STALE' },
                });
              }
            }
          }
        }
      }

      await tx.auditEvent.create({
        data: {
          id: newId(),
          workspaceId: args.workspaceId,
          actorUserId: args.createdByUserId,
          action: 'workflow.snapshot',
          subjectType: 'workflow_revision',
          subjectId: revision.id,
          metadataJson: {
            workflowId: args.workflowId,
            revision: nextRev,
            draftRevisionNumber: args.ifRevision,
          },
        },
      });

      const fresh = await tx.workflow.findFirst({
        where: { id: args.workflowId, workspaceId: args.workspaceId },
        include: { draft: true },
      });
      if (!fresh) throw new WorkflowNotFoundError('Workflow missing after snapshot');
      return { workflow: fresh, revision };
    });
  }

  parseGraph(draft: WorkflowDraft): WorkflowGraph {
    return asGraph(draft.graphJson);
  }

  parseGraphJson(json: unknown): WorkflowGraph {
    return asGraph(json);
  }
}
