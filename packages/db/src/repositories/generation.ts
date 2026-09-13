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
  computeInputFingerprint,
  computeOutpaintCanvas,
  computeUpscaleTargetDims,
  extractEditParams,
  extractImageAssetVersionId,
  extractMaskId,
  extractOutpaintParams,
  extractPromptFromInputs,
  extractReferenceAssetVersionIds,
  extractTruthRevisionId,
  extractUpscaleParams,
  getModelByKey,
  resolveModelRegistry,
  isDeterministicNodeType,
  operationForNodeType,
  resolutionToPixels,
  resolvePortInputs,
  reserveIdempotencyKey,
  refundIdempotencyKey,
  settleIdempotencyKey,
  type BudgetLimit,
  type WorkflowGraph,
} from '@studio/domain';
import { NodeResultRepository } from './node-results.js';
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
  private readonly nodeResults: NodeResultRepository;

  constructor(private readonly db: PrismaClient) {
    this.outbox = new OutboxRepository(db);
    this.credits = new CreditRepository(db);
    this.nodeResults = new NodeResultRepository(db);
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

    const registry = resolveModelRegistry(process.env.IMAGE_PROVIDER);
    const provider = (process.env.IMAGE_PROVIDER ?? 'fake').trim().toLowerCase();
    const defaultKey =
      provider === 'kie' || provider === 'kie.ai' || provider === 'kieai'
        ? 'kie-seedream-5-pro-generate'
        : FAKE_PRIMARY_MODEL.key;
    const model = getModelByKey(input.modelKey ?? defaultKey, registry) ?? getModelByKey(defaultKey, registry) ?? FAKE_PRIMARY_MODEL;
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

    try {
    const run = await this.db.$transaction(async (tx) => {
      // Re-check inside the tx so concurrent identical keys cannot double-create.
      const raced = await tx.generationRun.findUnique({
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
      if (raced) {
        return { kind: 'existing' as const, run: raced };
      }

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

      const fullGraph = {
        schemaVersion: 1,
        nodes: (graph.nodes ?? []).map((n) => ({
          id: n.id,
          type: n.type,
          position: { x: 0, y: 0 },
          config: n.config ?? {},
        })),
        edges: (graph.edges ?? []) as WorkflowGraph['edges'],
      } satisfies WorkflowGraph;

      for (const node of nodes) {
        const upscaleParamsEarly =
          node.type === 'upscale'
            ? extractUpscaleParams({
                id: node.id,
                type: node.type,
                position: { x: 0, y: 0 },
                config: node.config,
              })
            : null;
        const nodeModel =
          getModelByKey(
            (typeof node.config?.modelKey === 'string' ? node.config.modelKey : undefined) ??
              upscaleParamsEarly?.engineKey ??
              input.modelKey ??
              defaultKey,
            registry,
          ) ?? model;
        const op = operationForNodeType(node.type) ?? 'GENERATE';
        const inputs = resolvePortInputs(fullGraph, node.id);
        const { prompt, negativePrompt, shotBriefId } = extractPromptFromInputs(
          { id: node.id, type: node.type, position: { x: 0, y: 0 }, config: node.config },
          inputs,
        );
        const truthRevisionId = extractTruthRevisionId(
          { id: node.id, type: node.type, position: { x: 0, y: 0 }, config: node.config },
          inputs,
        );
        const refIds = [...extractReferenceAssetVersionIds(inputs)];
        const imageVersionId = extractImageAssetVersionId(inputs);
        // Prefer source image WxH for edit/inpaint/cutout; fall back to resolution tier.
        let dims = resolutionToPixels(
          typeof node.config?.resolution === 'string' ? node.config.resolution : '2K',
        );
        let sourceWidth: number | null = null;
        let sourceHeight: number | null = null;
        if (imageVersionId) {
          const imgVer = await tx.assetVersion.findFirst({
            where: { id: imageVersionId, workspaceId: input.workspaceId },
          });
          if (imgVer?.width && imgVer?.height) {
            sourceWidth = imgVer.width;
            sourceHeight = imgVer.height;
            dims = { width: imgVer.width, height: imgVer.height };
          }
          if (!refIds.includes(imageVersionId)) {
            refIds.push(imageVersionId);
          }
        }

        const outpaintParams =
          node.type === 'outpaint'
            ? extractOutpaintParams({
                id: node.id,
                type: node.type,
                position: { x: 0, y: 0 },
                config: node.config,
              })
            : null;
        const upscaleParams =
          upscaleParamsEarly ??
          (node.type === 'upscale'
            ? extractUpscaleParams({
                id: node.id,
                type: node.type,
                position: { x: 0, y: 0 },
                config: node.config,
              })
            : null);

        let outpaintCanvas: ReturnType<typeof computeOutpaintCanvas> | null = null;
        if (node.type === 'outpaint' && outpaintParams) {
          const srcW = sourceWidth ?? dims.width;
          const srcH = sourceHeight ?? dims.height;
          outpaintCanvas = computeOutpaintCanvas({
            sourceWidth: srcW,
            sourceHeight: srcH,
            targetRatio: outpaintParams.targetRatio,
            placement: outpaintParams.placement,
          });
          dims = { width: outpaintCanvas.canvasWidth, height: outpaintCanvas.canvasHeight };
        }
        if (node.type === 'upscale' && upscaleParams) {
          const srcW = sourceWidth ?? dims.width;
          const srcH = sourceHeight ?? dims.height;
          const target = computeUpscaleTargetDims({
            sourceWidth: srcW,
            sourceHeight: srcH,
            targetResolution: upscaleParams.targetResolution,
          });
          dims = { width: target.width, height: target.height };
        }

        const count =
          typeof node.config?.count === 'number' && node.type === 'generate'
            ? Math.min(8, Math.max(1, node.config.count as number))
            : 1;

        const editParams = extractEditParams({
          id: node.id,
          type: node.type,
          position: { x: 0, y: 0 },
          config: node.config,
        });
        const maskId = extractMaskId(
          { id: node.id, type: node.type, position: { x: 0, y: 0 }, config: node.config },
          inputs,
        );

        // Resolve sha256 for upstream assets when present (unknown → still fingerprint, mark unreproducible)
        const upstreamAssets: Array<{
          portId: string;
          order: number;
          assetVersionId: string;
          sha256: string;
        }> = [];
        const unknownFields: string[] = [];
        for (let i = 0; i < refIds.length; i++) {
          const avId = refIds[i]!;
          const ver = await tx.assetVersion.findFirst({
            where: { id: avId, workspaceId: input.workspaceId },
          });
          if (!ver) {
            unknownFields.push(`upstreamAssets[${i}].sha256`);
            upstreamAssets.push({
              portId: inputs.find((x) => x.sourceConfig.assetVersionId === avId)?.portId ?? 'references',
              order: i,
              assetVersionId: avId,
              sha256: 'unknown',
            });
          } else {
            upstreamAssets.push({
              portId: inputs.find((x) => x.sourceConfig.assetVersionId === avId)?.portId ?? 'references',
              order: i,
              assetVersionId: avId,
              sha256: ver.sha256,
            });
          }
        }

        const masks: Array<{ maskId: string; representationSha256: string }> = [];
        if (maskId) {
          const maskRow = await tx.mask.findFirst({
            where: { id: maskId, workspaceId: input.workspaceId, deletedAt: null },
          });
          if (!maskRow) {
            unknownFields.push('masks[0].representationSha256');
            masks.push({ maskId, representationSha256: 'unknown' });
          } else {
            const meta = (maskRow.metadataJson ?? {}) as Record<string, unknown>;
            const sha =
              typeof meta.renderedSha256 === 'string'
                ? meta.renderedSha256
                : typeof meta.maskAssetVersionId === 'string'
                  ? 'pending-render'
                  : 'strokes-only';
            if (sha === 'pending-render' || sha === 'strokes-only') {
              // Still fingerprintable via mask id + strokes hash proxy
              masks.push({
                maskId,
                representationSha256: `strokes:${JSON.stringify(maskRow.strokesJson).slice(0, 64)}`,
              });
            } else {
              masks.push({ maskId, representationSha256: sha });
            }
          }
        }

        const fp = computeInputFingerprint({
          nodeType: node.type,
          nodeConfig: (node.config ?? {}) as Record<string, unknown>,
          upstreamAssets,
          masks,
          truthRevisionId,
          shotBriefRevisionId: shotBriefId,
          prompt,
          negativePrompt,
          modelRegistryConfigVersion: nodeModel.configVersion,
          unknownFields,
        });

        // Reuse path: deterministic always; generative only when reuseSucceededInputs=true
        const reusable = await tx.nodeResult.findFirst({
          where: {
            workspaceId: input.workspaceId,
            workflowRevisionId: revision.id,
            nodeId: node.id,
            status: 'SUCCEEDED',
            inputFingerprint: fp.sha256,
          },
        });
        // Spec §32.1: generative ops must never silently reuse — only deterministic
        // auto-reuse when fingerprint matches. Fake scenario overrides always re-run.
        const mayReuse =
          !!reusable &&
          !input.scenario &&
          isDeterministicNodeType(node.type) &&
          input.reuseSucceededInputs !== false;

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
            status: mayReuse ? 'SUCCEEDED' : 'QUEUED',
            modelKey: nodeModel.key,
          },
        });

        if (mayReuse) {
          continue;
        }

        const attemptId = newId();
        const attemptNo = 1;
        const attemptIdem = `${itemKey}:attempt:${attemptNo}`;
        const scenario =
          input.scenario ??
          (typeof node.config?.scenario === 'string' ? node.config.scenario : undefined);

        const requestSnapshot = {
          operation: op,
          prompt,
          negativePrompt: negativePrompt || undefined,
          modelId: nodeModel.modelId,
          width: dims.width,
          height: dims.height,
          aspectRatio:
            outpaintParams?.targetRatio ??
            (typeof node.config?.ratio === 'string' ? node.config.ratio : '1:1'),
          resolutionTier:
            upscaleParams?.targetResolution ??
            (typeof node.config?.resolution === 'string' ? node.config.resolution : '2K'),
          count,
          seed: typeof node.config?.seed === 'number' ? node.config.seed : undefined,
          strength: editParams.strength,
          idempotencyKey: attemptIdem,
          scenario,
          nodeId: node.id,
          nodeType: node.type,
          truthRevisionId,
          shotBriefId,
          referenceAssetVersionIds: refIds,
          maskId: maskId ?? undefined,
          fidelity: editParams.fidelity,
          lightBlend: editParams.lightBlend,
          targetRatio: outpaintParams?.targetRatio,
          placement: outpaintParams?.placement,
          engineKey: upscaleParams?.engineKey,
          targetResolution: upscaleParams?.targetResolution,
          inputFingerprint: fp.sha256,
          fingerprintReproducible: fp.reproducible,
          subjectHint:
            typeof node.config?.subjectHint === 'string' ? node.config.subjectHint : undefined,
          edgeMode: typeof node.config?.edgeMode === 'string' ? node.config.edgeMode : undefined,
          clientMetadata: {
            workflowRevisionId: revision.id,
            projectId: revision.workflow.projectId,
            fidelity: editParams.fidelity,
            lightBlend: editParams.lightBlend,
            strength: editParams.strength,
            maskId: maskId ?? undefined,
            productLock: node.type === 'replace_background',
            targetRatio: outpaintParams?.targetRatio,
            placement: outpaintParams?.placement,
            offsetX: outpaintCanvas?.offsetX,
            offsetY: outpaintCanvas?.offsetY,
            sourceWidth: sourceWidth ?? undefined,
            sourceHeight: sourceHeight ?? undefined,
            engineKey: upscaleParams?.engineKey,
            targetResolution: upscaleParams?.targetResolution,
          },
        };

        await tx.generationAttempt.create({
          data: {
            id: attemptId,
            workspaceId: input.workspaceId,
            itemId,
            attemptNo,
            idempotencyKey: attemptIdem,
            provider: nodeModel.provider,
            modelId: nodeModel.modelId,
            modelSnapshotJson: nodeModel as unknown as Prisma.InputJsonValue,
            requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
            inputFingerprint: fp.sha256,
            status: 'QUEUED',
          },
        });

        const reserveMicro = amountToMicrounits(nodeModel.pricing.estimatedUnitCost) * count;
        await this.credits.appendEvent(
          input.workspaceId,
          {
            type: 'RESERVE',
            microunits: reserveMicro,
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

      // If every item was satisfied by fingerprint reuse, mark run SUCCEEDED.
      const items = await tx.generationItem.findMany({ where: { runId, workspaceId: input.workspaceId } });
      if (items.length > 0 && items.every((i) => i.status === 'SUCCEEDED')) {
        await tx.generationRun.update({
          where: { id: runId },
          data: { status: 'SUCCEEDED' },
        });
      }

      return { kind: 'created' as const, run: createdRun };
    });

    if (run.kind === 'existing') {
      return { run: run.run, outboxRows: [], created: false };
    }

    const detail = await this.getRun(input.workspaceId, run.run.id);
    if (!detail) throw new Error('Run missing after create');
    return { run: detail, outboxRows, created: true };
    } catch (err) {
      // Unique(workspaceId, idempotencyKey) race: treat as idempotent hit.
      const code = typeof err === 'object' && err && 'code' in err ? (err as { code?: string }).code : undefined;
      if (code === 'P2002') {
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
        if (existing) return { run: existing, outboxRows: [], created: false };
      }
      throw err;
    }
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
