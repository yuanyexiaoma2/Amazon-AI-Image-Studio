import type {
  PrismaClient,
  Workflow,
  WorkflowCommandBatch,
  WorkflowDraft,
  WorkflowRevision,
} from '@prisma/client';
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

export type WorkflowUndoReason =
  | 'NOTHING_TO_UNDO'
  | 'ALREADY_UNDONE'
  | 'NOTHING_TO_REDO'
  | 'NOT_UNDONE';

export class WorkflowUndoError extends Error {
  readonly code = 'WORKFLOW_UNDO_CONFLICT';
  constructor(
    message: string,
    public readonly reason: WorkflowUndoReason,
  ) {
    super(message);
    this.name = 'WorkflowUndoError';
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

  /**
   * V2 PR-2: apply a command batch atomically.
   * Idempotent on (workflowId, batchId): a replayed batchId returns the existing
   * batch + current draft with replayed=true and does NOT advance the revision.
   * Otherwise the draft is conditionally updated (same 409 semantics as saveDraft,
   * graph=afterGraph, revisionNumber+1) and the batch row is inserted.
   */
  async applyCommandBatch(args: {
    workspaceId: string;
    workflowId: string;
    ifRevision: number;
    batchId: string;
    actorUserId: string;
    commands: unknown[];
    beforeGraph: WorkflowGraph;
    afterGraph: WorkflowGraph;
    name?: string;
  }): Promise<{ batch: WorkflowCommandBatch; draft: WorkflowWithDraft; replayed: boolean }> {
    const validation = validateWorkflowGraph(args.afterGraph);
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

      const existing = await tx.workflowCommandBatch.findFirst({
        where: { workspaceId: args.workspaceId, workflowId: args.workflowId, batchId: args.batchId },
      });
      if (existing) {
        const current = await tx.workflow.findFirst({
          where: { id: args.workflowId, workspaceId: args.workspaceId },
          include: { draft: true },
        });
        if (!current?.draft) {
          throw new WorkflowNotFoundError('Workflow draft missing on batch replay');
        }
        return { batch: existing, draft: current, replayed: true };
      }

      const draftUpdate = await tx.workflowDraft.updateMany({
        where: {
          workspaceId: args.workspaceId,
          workflowId: args.workflowId,
          revisionNumber: args.ifRevision,
        },
        data: {
          graphJson: args.afterGraph as object,
          revisionNumber: args.ifRevision + 1,
          updatedByUserId: args.actorUserId,
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

      const batch = await tx.workflowCommandBatch.create({
        data: {
          id: newId(),
          workspaceId: args.workspaceId,
          workflowId: args.workflowId,
          batchId: args.batchId,
          actorUserId: args.actorUserId,
          commandsJson: args.commands as object[],
          beforeGraphJson: args.beforeGraph as object,
          afterGraphJson: args.afterGraph as object,
          baseRevisionNumber: args.ifRevision,
          resultRevisionNumber: args.ifRevision + 1,
        },
      });

      await tx.auditEvent.create({
        data: {
          id: newId(),
          workspaceId: args.workspaceId,
          actorUserId: args.actorUserId,
          action: 'workflow.draft_saved',
          subjectType: 'workflow',
          subjectId: args.workflowId,
          metadataJson: {
            ifRevision: args.ifRevision,
            nextRevision: args.ifRevision + 1,
            batchId: args.batchId,
            commandCount: args.commands.length,
            nodeCount: args.afterGraph.nodes.length,
            edgeCount: args.afterGraph.edges.length,
          },
        },
      });

      const fresh = await tx.workflow.findFirst({
        where: { id: args.workflowId, workspaceId: args.workspaceId },
        include: { draft: true },
      });
      if (!fresh?.draft) {
        throw new WorkflowNotFoundError('Workflow draft missing after command batch');
      }
      return { batch, draft: fresh, replayed: false };
    });
  }

  /**
   * V2 PR-2: look up a command batch by client batchId (idempotency pre-check —
   * lets the API replay a batch without re-applying its commands to the graph).
   */
  async getCommandBatch(
    workspaceId: string,
    workflowId: string,
    batchId: string,
  ): Promise<WorkflowCommandBatch | null> {
    return this.db.workflowCommandBatch.findFirst({
      where: { workspaceId, workflowId, batchId },
    });
  }

  /**
   * V2 PR-2: undo a command batch — draft graph rolls back to batch.beforeGraph.
   * Target: explicit batchId, else the most recent non-undone batch.
   * Conditional draft update on ifRevision (409 semantics); sets undone_at.
   */
  async undoCommandBatch(args: {
    workspaceId: string;
    workflowId: string;
    ifRevision: number;
    batchId?: string;
  }): Promise<{ batch: WorkflowCommandBatch; draft: WorkflowWithDraft }> {
    return this.settleCommandBatchUndo(args, 'undo');
  }

  /**
   * V2 PR-2: redo a command batch — draft graph re-applies batch.afterGraph.
   * Target: explicit batchId, else the most recent undone batch. Clears undone_at.
   */
  async redoCommandBatch(args: {
    workspaceId: string;
    workflowId: string;
    ifRevision: number;
    batchId?: string;
  }): Promise<{ batch: WorkflowCommandBatch; draft: WorkflowWithDraft }> {
    return this.settleCommandBatchUndo(args, 'redo');
  }

  private async settleCommandBatchUndo(
    args: { workspaceId: string; workflowId: string; ifRevision: number; batchId?: string },
    direction: 'undo' | 'redo',
  ): Promise<{ batch: WorkflowCommandBatch; draft: WorkflowWithDraft }> {
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

      const batch = args.batchId
        ? await tx.workflowCommandBatch.findFirst({
            where: {
              workspaceId: args.workspaceId,
              workflowId: args.workflowId,
              batchId: args.batchId,
            },
          })
        : await tx.workflowCommandBatch.findFirst({
            where: {
              workspaceId: args.workspaceId,
              workflowId: args.workflowId,
              undoneAt: direction === 'undo' ? null : { not: null },
            },
            orderBy: { createdAt: 'desc' },
          });

      if (!batch) {
        throw new WorkflowUndoError(
          direction === 'undo'
            ? 'WORKFLOW_UNDO_CONFLICT: nothing to undo'
            : 'WORKFLOW_UNDO_CONFLICT: nothing to redo',
          direction === 'undo' ? 'NOTHING_TO_UNDO' : 'NOTHING_TO_REDO',
        );
      }
      if (direction === 'undo' && batch.undoneAt) {
        throw new WorkflowUndoError(
          'WORKFLOW_UNDO_CONFLICT: batch already undone',
          'ALREADY_UNDONE',
        );
      }
      if (direction === 'redo' && !batch.undoneAt) {
        throw new WorkflowUndoError(
          'WORKFLOW_UNDO_CONFLICT: batch is not undone',
          'NOT_UNDONE',
        );
      }

      const graph = asGraph(direction === 'undo' ? batch.beforeGraphJson : batch.afterGraphJson);

      const draftUpdate = await tx.workflowDraft.updateMany({
        where: {
          workspaceId: args.workspaceId,
          workflowId: args.workflowId,
          revisionNumber: args.ifRevision,
        },
        data: {
          graphJson: graph as object,
          revisionNumber: args.ifRevision + 1,
        },
      });
      if (draftUpdate.count !== 1) {
        throw new WorkflowConflictError(
          'WORKFLOW_REVISION_CONFLICT: draft conditional update affected 0 rows (stale ifRevision)',
        );
      }

      const batchUpdate = await tx.workflowCommandBatch.updateMany({
        where: {
          id: batch.id,
          undoneAt: direction === 'undo' ? null : { not: null },
        },
        data: { undoneAt: direction === 'undo' ? new Date() : null },
      });
      if (batchUpdate.count !== 1) {
        throw new WorkflowUndoError(
          'WORKFLOW_UNDO_CONFLICT: batch undo state changed concurrently',
          direction === 'undo' ? 'ALREADY_UNDONE' : 'NOT_UNDONE',
        );
      }

      const freshBatch = await tx.workflowCommandBatch.findUnique({ where: { id: batch.id } });
      const fresh = await tx.workflow.findFirst({
        where: { id: args.workflowId, workspaceId: args.workspaceId },
        include: { draft: true },
      });
      if (!freshBatch || !fresh?.draft) {
        throw new WorkflowNotFoundError('Workflow state missing after undo/redo');
      }
      return { batch: freshBatch, draft: fresh };
    });
  }

  parseGraph(draft: WorkflowDraft): WorkflowGraph {
    return asGraph(draft.graphJson);
  }

  parseGraphJson(json: unknown): WorkflowGraph {
    return asGraph(json);
  }
}
