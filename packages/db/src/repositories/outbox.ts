import type { OutboxMessage, OutboxStatus, Prisma, PrismaClient } from '@prisma/client';
import { newId } from '../ids.js';

export type EnqueueOutboxInput = {
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  jobName: string;
  jobId: string;
  payload: Prisma.InputJsonValue;
};

export class OutboxRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Insert PENDING outbox row (call inside the same transaction as status change). */
  async createPending(
    tx: Prisma.TransactionClient,
    input: EnqueueOutboxInput,
  ): Promise<OutboxMessage> {
    return tx.outboxMessage.create({
      data: {
        id: newId(),
        workspaceId: input.workspaceId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        jobName: input.jobName,
        jobId: input.jobId,
        payload: input.payload,
        status: 'PENDING',
        attempts: 0,
      },
    });
  }

  async findByJobId(jobId: string): Promise<OutboxMessage | null> {
    return this.db.outboxMessage.findUnique({ where: { jobId } });
  }

  async listPending(limit = 50): Promise<OutboxMessage[]> {
    return this.db.outboxMessage.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async markPublished(workspaceId: string, id: string): Promise<OutboxMessage> {
    const rows = await this.db.outboxMessage.updateMany({
      where: { id, workspaceId, status: { in: ['PENDING', 'FAILED'] satisfies OutboxStatus[] } },
      data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null },
    });
    if (rows.count === 0) {
      const existing = await this.db.outboxMessage.findFirst({ where: { id, workspaceId } });
      if (!existing) throw new Error('Outbox message not found');
      return existing;
    }
    return this.db.outboxMessage.findFirstOrThrow({ where: { id, workspaceId } });
  }

  async markFailed(workspaceId: string, id: string, error: string): Promise<void> {
    await this.db.outboxMessage.updateMany({
      where: { id, workspaceId },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: error.slice(0, 2000),
      },
    });
  }

  async bumpAttempt(workspaceId: string, id: string, error: string): Promise<void> {
    await this.db.outboxMessage.updateMany({
      where: { id, workspaceId, status: 'PENDING' },
      data: {
        attempts: { increment: 1 },
        lastError: error.slice(0, 2000),
      },
    });
  }
}

/** Stable BullMQ job id for inspect — same upload always maps to one job. */
export function inspectJobId(uploadId: string): string {
  return `inspect-${uploadId}`;
}

/** Stable BullMQ job id for generation attempt. */
export function generationAttemptJobId(attemptId: string): string {
  return `gen-attempt-${attemptId}`;
}

/** Stable BullMQ job id for QA evaluate. */
export function qaEvaluateJobId(reportId: string): string {
  return `qa-evaluate-${reportId}`;
}

/** Stable BullMQ job id for export bundle. */
export function exportBundleJobId(bundleId: string): string {
  return `export-bundle-${bundleId}`;
}
