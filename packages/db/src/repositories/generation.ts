import type {
  GenerationAttempt,
  GenerationItem,
  GenerationRun,
  OutboxMessage,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  FAKE_PRIMARY_MODEL,
  amountToMicrounits,
  budgetExceeded,
  canCancelRun,
  canRetryAttempt,
  getModelByKey,
  reserveIdempotencyKey,
  refundIdempotencyKey,
  settleIdempotencyKey,
  type BudgetLimit,
} from '@studio/domain';
import { newId } from '../ids.js';
import { OutboxRepository, generationAttemptJobId } from './outbox.js';
import { CreditRepository, CreditInsufficientError } from './credits.js';

export class GenerationValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GenerationValidationError';
  }
}

export class GenerationNotFoundError extends Error {
  constructor(message = 'Generation resource not found') {
    super(message);
    this.name = 'GenerationNotFoundError';
  }
}

export class GenerationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationConflictError';
  }
}

export class BudgetGateError extends Error {
  constructor(
    message: string,
    public readonly estimateMicrounits: number,
    public readonly budgetAmount: number,
  ) {
    super(message);
    this.name = 'BudgetGateError';
  }
}

export type CreateRunInput = {
  workspaceId: string;
  workflowRevisionId: string;
  requestedByUserId: string;
  scope?: { type: 'ALL' | 'BRANCH_FROM' | 'NODES'; nodeId?: string; nodeIds?: string[] };
  reuseSucceededInputs?: boolean;
  budgetLimit?: BudgetLimit | null;
  confirmBudget?: boolean;
  idempotencyKey: string;
  /** Override model key (default primary-image-generate). */
  modelKey?: string;
  /** Fake scenario applied to all attempts (W4-06 / e2e). */
  scenario?: string;
};

export type GenerationRunDetail = GenerationRun & {
  items: Array<
    GenerationItem & {
      attempts: GenerationAttempt[];
    }
  >;
};

type GraphNode = { id: string; type: string; config?: Record<string, unknown> };
type GraphJson = { nodes?: GraphNode[]; edges?: unknown[] };

const EXECUTABLE_TYPES = new Set([
  'generate',
  'remove_background',
  'replace_background',
  'inpaint',
  'outpaint',
  'upscale',
]);

function selectNodes(graph: GraphJson, scope: CreateRunInput['scope']): GraphNode[] {
  const nodes = (graph.nodes ?? []).filter((n) => EXECUTABLE_TYPES.has(n.type));
  if (!scope || scope.type === 'ALL') return nodes;
  if (scope.type === 'NODES' && scope.nodeIds?.length) {
    const set = new Set(scope.nodeIds);
    return nodes.filter((n) => set.has(n.id));
  }
  if (scope.type === 'BRANCH_FROM' && scope.nodeId) {
    // MVP: just the named node (full branch walk is W5+).
    return nodes.filter((n) => n.id === scope.nodeId);
  }
  return nodes;
}

export class GenerationRepository {
  private readonly outbox: OutboxRepository;
  private readonly credits: CreditRepository;

  constructor(private readonly db: PrismaClient) {
    this.outbox = new OutboxRepository(db);
    this.credits = new CreditRepository(db);
  }

  async getRun(workspaceId: string, runId: string): Promise<GenerationRunDetail | null> {
    return this.db.generationRun.findFirst({
      where: { id: runId, workspaceId },
      include: {
        items: {
          include: { attempts: { orderBy: { attemptNo: 'asc' } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async listRunsForProject(workspaceId: string, projectId: string, limit = 20) {
    return this.db.generationRun.findMany({
      where: { workspaceId, projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        items: {
          include: { attempts: { orderBy: { attemptNo: 'desc' }, take: 1 } },
        },
      },
    });
  }

  async createRun(
    input: CreateRunInput,
  ): Promise<{ run: GenerationRunDetail; outboxRows: OutboxMessage[]; created: boolean }> {
    const existing = await this.db.generationRun.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: {
        items: { include: { attempts: { orderBy: { attemptNo: 'asc' } } } },
      },
    });
    if (existing) {
      return { run: existing, outboxRows: [], created: false };
    }

    const revision = await this.db.workflowRevision.findFirst({
      where: { id: input.workflowRevisionId, workspaceId: input.workspaceId },
      include: { workflow: true },
    });
    if (!revision) throw new GenerationNotFoundError('Workflow revision not found');

    const graph = revision.graphJson as GraphJson;
    const nodes = selectNodes(graph, input.scope ?? { type: 'ALL' });
    if (nodes.length === 0) {
      throw new GenerationValidationError('No executable nodes in scope');
    }

    const model = getModelByKey(input.modelKey ?? FAKE_PRIMARY_MODEL.key) ?? FAKE_PRIMARY_MODEL;
    const unitMicro = amountToMicrounits(model.pricing.estimatedUnitCost);
    const estimateMicrounits = unitMicro * nodes.length;
    const currency = model.pricing.currency;

    if (
      budgetExceeded(
        { currency, estimatedMicrounits: estimateMicrounits, unitCount: nodes.length },
        input.budgetLimit,
      ) &&
      !input.confirmBudget
    ) {
      throw new BudgetGateError(
        'Estimated cost exceeds budgetLimit; pass confirmBudget=true to proceed',
        estimateMicrounits,
        input.budgetLimit!.amount,
      );
    }

    await this.credits.ensureAccount(input.workspaceId);

    const outboxRows: OutboxMessage[] = [];

    const run = await this.db.$transaction(async (tx) => {
      const runId = newId();
      const createdRun = await tx.generationRun.create({
        data: {
          id: runId,
          workspaceId: input.workspaceId,
          projectId: revision.workflow.projectId,
          workflowRevisionId: revision.id,
          scopeJson: (input.scope ?? { type: 'ALL' }) as Prisma.InputJsonValue,
          status: 'QUEUED',
          requestedByUserId: input.requestedByUserId,
          budgetLimitJson: (input.budgetLimit ?? null) as Prisma.InputJsonValue,
          estimateMicrounits,
          currency,
          idempotencyKey: input.idempotencyKey,
          confirmBudget: input.confirmBudget ?? false,
        },
      });

      for (const node of nodes) {
        const itemId = newId();
        const itemKey = `${runId}:${node.id}:0`;
        await tx.generationItem.create({
          data: {
            id: itemId,
            workspaceId: input.workspaceId,
            runId,
            nodeId: node.id,
            outputIndex: 0,
            itemKey,
            status: 'QUEUED',
            modelKey: model.key,
          },
        });

        const attemptId = newId();
        const attemptNo = 1;
        const attemptIdem = `${itemKey}:attempt:${attemptNo}`;
        const prompt =
          typeof node.config?.prompt === 'string'
            ? node.config.prompt
            : `Generate for node ${node.id}`;
        const scenario =
          input.scenario ??
          (typeof node.config?.scenario === 'string' ? node.config.scenario : undefined);

        await tx.generationAttempt.create({
          data: {
            id: attemptId,
            workspaceId: input.workspaceId,
            itemId,
            attemptNo,
            idempotencyKey: attemptIdem,
            provider: model.provider,
            modelId: model.modelId,
            modelSnapshotJson: model as unknown as Prisma.InputJsonValue,
            requestSnapshot: {
              operation: 'GENERATE',
              prompt,
              modelId: model.modelId,
              width: 1024,
              height: 1024,
              idempotencyKey: attemptIdem,
              scenario,
              nodeId: node.id,
              nodeType: node.type,
            } as Prisma.InputJsonValue,
            status: 'QUEUED',
          },
        });

        await this.credits.appendEvent(
          input.workspaceId,
          {
            type: 'RESERVE',
            microunits: unitMicro,
            idempotencyKey: reserveIdempotencyKey(attemptId),
            attemptId,
            runId,
            note: `Reserve for attempt ${attemptId}`,
          },
          tx,
        );

        const jobId = generationAttemptJobId(attemptId);
        const row = await this.outbox.createPending(tx, {
          workspaceId: input.workspaceId,
          aggregateType: 'GenerationAttempt',
          aggregateId: attemptId,
          jobName: 'generation-attempt',
          jobId,
          payload: {
            workspaceId: input.workspaceId,
            projectId: revision.workflow.projectId,
            runId,
            itemId,
            attemptId,
          },
        });
        outboxRows.push(row);
      }

      return createdRun;
    });

    const detail = await this.getRun(input.workspaceId, run.id);
    if (!detail) throw new Error('Run missing after create');
    return { run: detail, outboxRows, created: true };
  }

  async requestCancel(workspaceId: string, runId: string): Promise<GenerationRunDetail> {
    const run = await this.getRun(workspaceId, runId);
    if (!run) throw new GenerationNotFoundError('Run not found');
    if (!canCancelRun(run.status as never) && run.status !== 'CANCEL_REQUESTED') {
      throw new GenerationConflictError(`Cannot cancel run in status ${run.status}`);
    }
    await this.db.generationRun.updateMany({
      where: { id: runId, workspaceId, status: { in: ['QUEUED', 'RUNNING', 'VALIDATING'] } },
      data: { status: 'CANCEL_REQUESTED' },
    });
    await this.db.generationItem.updateMany({
      where: {
        workspaceId,
        runId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      data: { status: 'CANCEL_REQUESTED' },
    });
    await this.db.generationAttempt.updateMany({
      where: {
        workspaceId,
        itemId: { in: run.items.map((i) => i.id) },
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      data: { status: 'CANCEL_REQUESTED' },
    });
    const updated = await this.getRun(workspaceId, runId);
    if (!updated) throw new GenerationNotFoundError();
    return updated;
  }

  async retryAttempt(
    workspaceId: string,
    attemptId: string,
    requestedByUserId: string,
  ): Promise<{ attempt: GenerationAttempt; outbox: OutboxMessage }> {
    void requestedByUserId;
    const prev = await this.db.generationAttempt.findFirst({
      where: { id: attemptId, workspaceId },
      include: { item: { include: { run: true } } },
    });
    if (!prev) throw new GenerationNotFoundError('Attempt not found');
    if (!canRetryAttempt(prev.status as never)) {
      throw new GenerationConflictError(`Cannot retry attempt in status ${prev.status}`);
    }

    const model = (prev.modelSnapshotJson as typeof FAKE_PRIMARY_MODEL) ?? FAKE_PRIMARY_MODEL;
    const unitMicro = amountToMicrounits(model.pricing?.estimatedUnitCost ?? 0.01);

    return this.db.$transaction(async (tx) => {
      const attemptNo = prev.attemptNo + 1;
      const newIdem = `${prev.item.itemKey}:attempt:${attemptNo}`;
      const newAttempt = await tx.generationAttempt.create({
        data: {
          id: newId(),
          workspaceId,
          itemId: prev.itemId,
          attemptNo,
          idempotencyKey: newIdem,
          provider: prev.provider,
          modelId: prev.modelId,
          modelSnapshotJson: prev.modelSnapshotJson as Prisma.InputJsonValue,
          requestSnapshot: {
            ...(prev.requestSnapshot as object),
            idempotencyKey: newIdem,
          } as Prisma.InputJsonValue,
          status: 'QUEUED',
          autoRetryCount: 0,
        },
      });

      await tx.generationItem.update({
        where: { id: prev.itemId },
        data: { status: 'QUEUED' },
      });
      await tx.generationRun.update({
        where: { id: prev.item.runId },
        data: { status: 'QUEUED' },
      });

      await this.credits.appendEvent(
        workspaceId,
        {
          type: 'RESERVE',
          microunits: unitMicro,
          idempotencyKey: reserveIdempotencyKey(newAttempt.id),
          attemptId: newAttempt.id,
          runId: prev.item.runId,
        },
        tx,
      );

      const outbox = await this.outbox.createPending(tx, {
        workspaceId,
        aggregateType: 'GenerationAttempt',
        aggregateId: newAttempt.id,
        jobName: 'generation-attempt',
        jobId: generationAttemptJobId(newAttempt.id),
        payload: {
          workspaceId,
          projectId: prev.item.run.projectId,
          runId: prev.item.runId,
          itemId: prev.itemId,
          attemptId: newAttempt.id,
        },
      });

      return { attempt: newAttempt, outbox };
    });
  }

  async publishProgress(
    workspaceId: string,
    projectId: string,
    type: string,
    payload: Record<string, unknown>,
    ids?: { runId?: string; attemptId?: string },
  ) {
    await this.db.progressEvent.create({
      data: {
        id: newId(),
        workspaceId,
        projectId,
        runId: ids?.runId ?? null,
        attemptId: ids?.attemptId ?? null,
        type,
        payloadJson: payload as Prisma.InputJsonValue,
      },
    });
  }

  async listProgressSince(
    workspaceId: string,
    projectId: string,
    since?: Date,
    limit = 50,
  ) {
    return this.db.progressEvent.findMany({
      where: {
        workspaceId,
        projectId,
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
}

export { CreditInsufficientError, settleIdempotencyKey, refundIdempotencyKey, reserveIdempotencyKey };
