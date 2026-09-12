import type { NodeResult, Prisma, PrismaClient } from '@prisma/client';
import type { StalePropagationEvent } from '@studio/domain';
import { newId } from '../ids.js';

export type UpsertNodeResultInput = {
  workspaceId: string;
  projectId: string;
  workflowRevisionId: string;
  nodeId: string;
  status: NodeResult['status'];
  inputFingerprint?: string | null;
  staleReason?: string | null;
  staleCause?: string | null;
  outputJson?: Prisma.InputJsonValue;
  lastAttemptId?: string | null;
};

export class NodeResultRepository {
  constructor(private readonly db: PrismaClient) {}

  async get(
    workspaceId: string,
    workflowRevisionId: string,
    nodeId: string,
  ): Promise<NodeResult | null> {
    return this.db.nodeResult.findUnique({
      where: {
        workspaceId_workflowRevisionId_nodeId: {
          workspaceId,
          workflowRevisionId,
          nodeId,
        },
      },
    });
  }

  async listForRevision(workspaceId: string, workflowRevisionId: string): Promise<NodeResult[]> {
    return this.db.nodeResult.findMany({
      where: { workspaceId, workflowRevisionId },
    });
  }

  async upsert(input: UpsertNodeResultInput): Promise<NodeResult> {
    const existing = await this.get(input.workspaceId, input.workflowRevisionId, input.nodeId);
    if (existing) {
      return this.db.nodeResult.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          inputFingerprint: input.inputFingerprint ?? existing.inputFingerprint,
          staleReason: input.staleReason ?? null,
          staleCause: input.staleCause ?? null,
          outputJson: input.outputJson ?? (existing.outputJson as Prisma.InputJsonValue),
          lastAttemptId: input.lastAttemptId ?? existing.lastAttemptId,
        },
      });
    }
    return this.db.nodeResult.create({
      data: {
        id: newId(),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workflowRevisionId: input.workflowRevisionId,
        nodeId: input.nodeId,
        status: input.status,
        inputFingerprint: input.inputFingerprint ?? null,
        staleReason: input.staleReason ?? null,
        staleCause: input.staleCause ?? null,
        outputJson: input.outputJson ?? {},
        lastAttemptId: input.lastAttemptId ?? null,
      },
    });
  }

  /**
   * Apply a STALE propagation event. Does not delete prior outputs —
   * marks NodeResult STALE and optionally marks CURRENT generation outputs as STALE disposition.
   */
  async applyStaleEvent(
    workspaceId: string,
    projectId: string,
    workflowRevisionId: string,
    event: StalePropagationEvent,
  ): Promise<number> {
    let n = 0;
    for (const nodeId of event.staleNodeIds) {
      await this.upsert({
        workspaceId,
        projectId,
        workflowRevisionId,
        nodeId,
        status: 'STALE',
        staleReason: event.reason,
        staleCause: event.cause,
      });
      n += 1;
    }
    return n;
  }

  /** True when a successful non-STALE result exists for fingerprint (reuse candidate). */
  async findReusable(
    workspaceId: string,
    workflowRevisionId: string,
    nodeId: string,
    fingerprint: string,
  ): Promise<NodeResult | null> {
    const row = await this.get(workspaceId, workflowRevisionId, nodeId);
    if (!row) return null;
    if (row.status !== 'SUCCEEDED') return null;
    if (row.inputFingerprint !== fingerprint) return null;
    return row;
  }
}
