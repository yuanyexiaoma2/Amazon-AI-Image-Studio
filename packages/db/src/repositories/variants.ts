import { Prisma } from '@prisma/client';
import type {
  PrismaClient,
  Variant,
  VariantComponent,
  VariantItem,
  VariantRun,
} from '@prisma/client';
import {
  DEFAULT_ALLOWED_CHANGES,
  DEFAULT_VARIANT_LOCKS,
  aggregateVariantRunStatus,
  applyVariantOverridesToGraph,
  assertVariantBatchBudget,
  defaultSevenSlots,
  normalizeVariantCode,
  validateComponents,
  validateMasterLink,
  validateVariantCode,
  variantLockQaExpectation,
  type VariantComponentInput,
  type VariantItemStatus,
  type VariantRunStatus,
  type BudgetLimit,
  amountToMicrounits,
  FAKE_PRIMARY_MODEL,
  reserveIdempotencyKey,
  settleIdempotencyKey,
  refundIdempotencyKey,
  type WorkflowGraph,
} from '@studio/domain';
import { newId } from '../ids.js';
import { CreditRepository, CreditInsufficientError } from './credits.js';
import { AssetRepository } from './assets.js';
import { QaRepository } from './qa.js';
import { WorkflowRepository } from './workflow.js';

export class VariantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VariantValidationError';
  }
}

export class VariantNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VariantNotFoundError';
  }
}

export class VariantBudgetGateError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
  constructor(
    message: string,
    public readonly estimateMicrounits: number,
    public readonly budgetAmount: number,
  ) {
    super(message);
    this.name = 'VariantBudgetGateError';
  }
}

export type VariantDetail = Variant & { components: VariantComponent[] };
export type VariantRunDetail = VariantRun & {
  items: Array<VariantItem & { variant?: { code: string } }>;
  members?: Array<{ variantId: string }>;
};

function asLocks(json: unknown): string[] {
  return Array.isArray(json) ? json.map(String) : [...DEFAULT_VARIANT_LOCKS];
}
function asAllowed(json: unknown): string[] {
  return Array.isArray(json) ? json.map(String) : [...DEFAULT_ALLOWED_CHANGES];
}

function componentInputsFromRows(rows: VariantComponent[]): VariantComponentInput[] {
  return rows.map((c) => ({
    componentKey: c.componentKey,
    colorHex: c.colorHex,
    colorDescription: c.colorDescription,
    material: c.material,
    locks: asLocks(c.locksJson),
    allowedChanges: asAllowed(c.allowedChangesJson),
  }));
}

/** Minimal 1x1 PNG fallback when caller does not inject produceImage (unit tests). */
export function fakeTinyPngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

export type FakeVariantImage = { bytes: Buffer; width: number; height: number };


export class VariantRepository {
  private readonly credits: CreditRepository;
  private readonly assets: AssetRepository;
  private readonly qa: QaRepository;
  private readonly workflows: WorkflowRepository;

  constructor(private readonly db: PrismaClient) {
    this.credits = new CreditRepository(db);
    this.assets = new AssetRepository(db);
    this.qa = new QaRepository(db);
    this.workflows = new WorkflowRepository(db);
  }

  async listByProject(workspaceId: string, projectId: string): Promise<VariantDetail[]> {
    return this.db.variant.findMany({
      where: { workspaceId, projectId },
      include: { components: { orderBy: { componentKey: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(workspaceId: string, variantId: string): Promise<VariantDetail | null> {
    return this.db.variant.findFirst({
      where: { id: variantId, workspaceId },
      include: { components: { orderBy: { componentKey: 'asc' } } },
    });
  }

  async create(input: {
    workspaceId: string;
    projectId: string;
    code: string;
    displayName: string;
    masterVariantId?: string | null;
    components?: VariantComponentInput[];
    status?: 'DRAFT' | 'READY' | 'ARCHIVED';
  }): Promise<VariantDetail> {
    const codeOk = validateVariantCode(input.code);
    if (!codeOk.ok) throw new VariantValidationError(codeOk.reason);
    const components = input.components ?? [];
    const compOk = validateComponents(components);
    if (!compOk.ok) throw new VariantValidationError(compOk.reason);

    let masterIsRoot = true;
    let sameProject = true;
    if (input.masterVariantId) {
      const master = await this.get(input.workspaceId, input.masterVariantId);
      if (!master) throw new VariantNotFoundError('Master variant not found');
      sameProject = master.projectId === input.projectId;
      masterIsRoot = master.masterVariantId == null;
    }
    const link = validateMasterLink({
      masterVariantId: input.masterVariantId,
      masterIsRoot,
      sameProject,
    });
    if (!link.ok) throw new VariantValidationError(link.reason);

    const id = newId();
    await this.db.$transaction(async (tx) => {
      await tx.variant.create({
        data: {
          id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          code: codeOk.code,
          displayName: input.displayName,
          masterVariantId: input.masterVariantId ?? null,
          status: input.status ?? 'DRAFT',
        },
      });
      if (components.length > 0) {
        await tx.variantComponent.createMany({
          data: components.map((c) => ({
            id: newId(),
            workspaceId: input.workspaceId,
            variantId: id,
            componentKey: c.componentKey.trim(),
            colorHex: c.colorHex ?? null,
            colorDescription: c.colorDescription ?? null,
            material: c.material ?? null,
            locksJson: (c.locks ?? [...DEFAULT_VARIANT_LOCKS]) as Prisma.InputJsonValue,
            allowedChangesJson: (c.allowedChanges ?? [
              ...DEFAULT_ALLOWED_CHANGES,
            ]) as Prisma.InputJsonValue,
          })),
        });
      }
    });
    const created = await this.get(input.workspaceId, id);
    if (!created) throw new Error('Variant create failed');
    return created;
  }

  async patch(
    workspaceId: string,
    variantId: string,
    input: {
      displayName?: string;
      status?: 'DRAFT' | 'READY' | 'ARCHIVED';
      components?: VariantComponentInput[];
      workflowId?: string | null;
    },
  ): Promise<VariantDetail> {
    const existing = await this.get(workspaceId, variantId);
    if (!existing) throw new VariantNotFoundError('Variant not found');
    if (input.components) {
      const compOk = validateComponents(input.components);
      if (!compOk.ok) throw new VariantValidationError(compOk.reason);
    }

    await this.db.$transaction(async (tx) => {
      await tx.variant.update({
        where: { id: variantId },
        data: {
          displayName: input.displayName ?? undefined,
          status: input.status ?? undefined,
          workflowId: input.workflowId === undefined ? undefined : input.workflowId,
        },
      });
      if (input.components) {
        await tx.variantComponent.deleteMany({ where: { workspaceId, variantId } });
        await tx.variantComponent.createMany({
          data: input.components.map((c) => ({
            id: newId(),
            workspaceId,
            variantId,
            componentKey: c.componentKey.trim(),
            colorHex: c.colorHex ?? null,
            colorDescription: c.colorDescription ?? null,
            material: c.material ?? null,
            locksJson: (c.locks ?? [...DEFAULT_VARIANT_LOCKS]) as Prisma.InputJsonValue,
            allowedChangesJson: (c.allowedChanges ?? [
              ...DEFAULT_ALLOWED_CHANGES,
            ]) as Prisma.InputJsonValue,
          })),
        });
      }
    });
    const updated = await this.get(workspaceId, variantId);
    if (!updated) throw new VariantNotFoundError('Variant missing after patch');
    return updated;
  }

  /**
   * Derive a child workflow from master workflow graph with color overrides.
   * Does not copy Approvals.
   */
  async materialize(input: {
    workspaceId: string;
    variantId: string;
    createdByUserId: string;
    sourceWorkflowId?: string;
    name?: string;
  }): Promise<{ variant: VariantDetail; workflowId: string; revisionId: string }> {
    const variant = await this.get(input.workspaceId, input.variantId);
    if (!variant) throw new VariantNotFoundError('Variant not found');
    if (!variant.masterVariantId) {
      throw new VariantValidationError('Only child variants can materialize from a master');
    }
    const master = await this.get(input.workspaceId, variant.masterVariantId);
    if (!master) throw new VariantNotFoundError('Master variant not found');

    const sourceWorkflowId = input.sourceWorkflowId ?? master.workflowId;
    if (!sourceWorkflowId) {
      throw new VariantValidationError('Master has no workflowId; pass sourceWorkflowId');
    }
    const source = await this.workflows.getWithDraft(input.workspaceId, sourceWorkflowId);
    if (!source?.draft) throw new VariantNotFoundError('Source workflow/draft not found');
    const graph = source.draft.graphJson as WorkflowGraph;
    const overridden = applyVariantOverridesToGraph(graph, {
      variantCode: variant.code,
      components: componentInputsFromRows(variant.components),
    });

    const created = await this.workflows.createWithGraph({
      workspaceId: input.workspaceId,
      projectId: variant.projectId,
      name: input.name ?? `Variant ${variant.code}`,
      createdByUserId: input.createdByUserId,
      graph: overridden,
    });

    await this.db.variant.update({
      where: { id: variant.id },
      data: { workflowId: created.id, status: 'READY' },
    });
    const refreshed = await this.get(input.workspaceId, variant.id);
    if (!refreshed) throw new Error('variant missing');
    const wf = await this.workflows.getWithDraft(input.workspaceId, created.id);
    const revRow = await this.db.workflowRevision.findFirst({
      where: { workspaceId: input.workspaceId, workflowId: created.id },
      orderBy: { revision: 'desc' },
    });
    return {
      variant: refreshed,
      workflowId: created.id,
      revisionId: wf?.currentRevisionId ?? revRow?.id ?? created.draft?.id ?? created.id,
    };
  }

  async getRun(workspaceId: string, runId: string): Promise<VariantRunDetail | null> {
    return this.db.variantRun.findFirst({
      where: { id: runId, workspaceId },
      include: {
        items: { orderBy: [{ slot: 'asc' }, { outputIndex: 'asc' }] },
        members: true,
      },
    });
  }

  /**
   * Create + Fake-execute a color×slot batch. One item failure does not block siblings.
   */
  async createAndExecuteFakeRun(input: {
    workspaceId: string;
    projectId: string;
    masterVariantId: string;
    variantIds: string[];
    requestedByUserId: string;
    idempotencyKey: string;
    budgetLimit?: BudgetLimit | null;
    confirmBudget?: boolean;
    scenario?: string;
    visionScenario?: string;
    itemScenarios?: Record<string, string>;
    /** Optional storage put for generated bytes */
    putObject?: (args: { key: string; body: Buffer; contentType: string }) => Promise<unknown>;
    /** Optional QA runner */
    runQa?: (args: { workspaceId: string; reportId: string }) => Promise<void>;
    /** Fake image producer (API injects 2000 white PNG via sharp). */
    produceImage?: () => Promise<FakeVariantImage>;
  }): Promise<VariantRunDetail> {
    const existing = await this.db.variantRun.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: { items: true, members: true },
    });
    if (existing) return existing;

    const master = await this.get(input.workspaceId, input.masterVariantId);
    if (!master) throw new VariantNotFoundError('Master variant not found');
    if (master.projectId !== input.projectId) {
      throw new VariantValidationError('Master project mismatch');
    }

    const variants: VariantDetail[] = [];
    for (const vid of input.variantIds) {
      const v = await this.get(input.workspaceId, vid);
      if (!v) throw new VariantNotFoundError(`Variant ${vid} not found`);
      if (v.projectId !== input.projectId) {
        throw new VariantValidationError('All variants must be in the project');
      }
      if (v.masterVariantId !== master.id && v.id !== master.id) {
        throw new VariantValidationError(`Variant ${v.code} is not a child of master`);
      }
      if (v.id === master.id) {
        throw new VariantValidationError('Do not include master in variantIds batch targets');
      }
      variants.push(v);
    }

    const budget = assertVariantBatchBudget({
      variantCount: variants.length,
      slotsPerVariant: 7,
      budgetLimit: input.budgetLimit,
      confirmBudget: input.confirmBudget,
    });
    if (!budget.ok) {
      throw new VariantBudgetGateError(
        budget.reason,
        budget.estimateMicrounits,
        input.budgetLimit?.amount ?? 0,
      );
    }

    await this.credits.ensureAccount(input.workspaceId);
    const slots = defaultSevenSlots();
    const unitMicro = amountToMicrounits(FAKE_PRIMARY_MODEL.pricing.estimatedUnitCost);

    const runId = newId();
    await this.db.$transaction(async (tx) => {
      await tx.variantRun.create({
        data: {
          id: runId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          masterVariantId: master.id,
          status: 'RUNNING',
          budgetLimitJson: (input.budgetLimit ?? null) as Prisma.InputJsonValue,
          estimateMicrounits: budget.estimateMicrounits,
          currency: FAKE_PRIMARY_MODEL.pricing.currency,
          confirmBudget: input.confirmBudget ?? false,
          idempotencyKey: input.idempotencyKey,
          requestedByUserId: input.requestedByUserId,
          scenarioJson: {
            scenario: input.scenario ?? null,
            visionScenario: input.visionScenario ?? null,
            itemScenarios: input.itemScenarios ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.variantRunMember.createMany({
        data: variants.map((v) => ({
          id: newId(),
          workspaceId: input.workspaceId,
          runId,
          variantId: v.id,
        })),
      });
      const itemRows: Prisma.VariantItemCreateManyInput[] = [];
      for (const v of variants) {
        for (const s of slots) {
          itemRows.push({
            id: newId(),
            workspaceId: input.workspaceId,
            variantId: v.id,
            variantRunId: runId,
            slot: s.slot,
            outputIndex: s.orderIndex - 1,
            status: 'QUEUED',
          });
        }
      }
      await tx.variantItem.createMany({ data: itemRows });
    });

    // Execute outside the create tx so one failure cannot roll back siblings.
    const items = await this.db.variantItem.findMany({
      where: { workspaceId: input.workspaceId, variantRunId: runId },
      orderBy: [{ createdAt: 'asc' }],
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));

    for (const item of items) {
      const v = variantById.get(item.variantId)!;
      const key = `${v.code}:${item.slot}`;
      const itemScenario =
        input.itemScenarios?.[key] ??
        input.itemScenarios?.['*'] ??
        input.scenario ??
        'SUCCESS';
      const visionScenario =
        input.itemScenarios?.[`${key}:vision`] ??
        input.visionScenario ??
        'SUCCESS';

      const attemptKey = `variant-item:${item.id}`;
      try {
        await this.credits.appendEvent(input.workspaceId, {
          type: 'RESERVE',
          microunits: unitMicro,
          idempotencyKey: reserveIdempotencyKey(attemptKey),
          runId: null,
          note: `variant reserve ${v.code}/${item.slot}`,
        });
      } catch (e) {
        if (e instanceof CreditInsufficientError) {
          await this.db.variantItem.update({
            where: { id: item.id },
            data: {
              status: 'FAILED_FINAL',
              errorClass: 'QUOTA',
              errorMessage: e.message,
            },
          });
          continue;
        }
        throw e;
      }

      await this.db.variantItem.update({
        where: { id: item.id },
        data: { status: 'RUNNING' },
      });

      const upper = itemScenario.toUpperCase();
      if (['AUTH', 'VALIDATION', 'POLICY', 'QUOTA', 'FAIL'].includes(upper)) {
        await this.credits.appendEvent(input.workspaceId, {
          type: 'REFUND',
          microunits: unitMicro,
          idempotencyKey: refundIdempotencyKey(attemptKey),
          note: `variant fail ${upper} ${v.code}/${item.slot}`,
        });
        await this.db.variantItem.update({
          where: { id: item.id },
          data: {
            status: 'FAILED_FINAL',
            errorClass: upper === 'FAIL' ? 'UNKNOWN' : upper,
            errorMessage: `Fake provider ${upper} for variant item`,
          },
        });
        continue;
      }

      // Fake success: ingest PNG asset
      const img = input.produceImage
        ? await input.produceImage()
        : { bytes: fakeTinyPngBytes(), width: 1, height: 1 };
      const bytes = img.bytes;
      const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
      const created = await this.assets.createGeneratedAssetWithVersion({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        createdByUserId: input.requestedByUserId,
        kind: 'GENERATED',
        originalFilename: `variant-${v.code}-${item.slot}.png`,
        sha256,
        mime: 'image/png',
        width: img.width,
        height: img.height,
        byteSize: bytes.length,
        storageKey: 'pending',
        representationKind: 'ORIGINAL_UPLOAD',
        metadataJson: {
          variantId: v.id,
          variantCode: v.code,
          slot: item.slot,
          fake: true,
        },
        primaryParentVersionId: null,
      });
      const storageKey = `workspaces/${input.workspaceId}/projects/${input.projectId}/variants/${v.code}/${item.slot}/${created.version.id}.png`;
      if (input.putObject) {
        await input.putObject({ key: storageKey, body: bytes, contentType: 'image/png' });
        await this.db.assetRepresentation.updateMany({
          where: { workspaceId: input.workspaceId, assetVersionId: created.version.id },
          data: { storageKey },
        });
      }

      await this.credits.appendEvent(input.workspaceId, {
        type: 'SETTLE',
        microunits: unitMicro,
        idempotencyKey: settleIdempotencyKey(attemptKey),
        note: `variant settle ${v.code}/${item.slot}`,
      });

      let qaReportId: string | null = null;
      let itemStatus: VariantItemStatus = 'SUCCEEDED';
      try {
        await this.qa.ensureBuiltinRulePack();
        const report = await this.qa.createQueuedReport({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          assetVersionId: created.version.id,
          createdByUserId: input.requestedByUserId,
          slot: item.slot,
          visionScenario,
          ocrScenario: 'SUCCESS',
        });
        qaReportId = report.id;
        if (input.runQa) {
          await input.runQa({ workspaceId: input.workspaceId, reportId: report.id });
          const finished = await this.qa.getReport(input.workspaceId, report.id);
          const overall = finished?.overallStatus;
          if (overall === 'BLOCK') itemStatus = 'QA_BLOCK';
          else if (overall === 'REVIEW') itemStatus = 'QA_REVIEW';
          else if (overall === 'PASS') itemStatus = 'QA_PASS';
          else itemStatus = 'SUCCEEDED';
        } else {
          // Domain expectation without full pixel QA (unit tests)
          const expect = variantLockQaExpectation(visionScenario);
          if (expect.overall === 'BLOCK') itemStatus = 'QA_BLOCK';
          else if (expect.overall === 'REVIEW') itemStatus = 'QA_REVIEW';
          else itemStatus = 'QA_PASS';
          await this.db.qaReport.update({
            where: { id: report.id },
            data: {
              status: 'SUCCEEDED',
              overallStatus: expect.overall,
              completedAt: new Date(),
            },
          });
        }
      } catch (qaErr) {
        itemStatus = 'SUCCEEDED';
        void qaErr;
      }

      await this.db.variantItem.update({
        where: { id: item.id },
        data: {
          status: itemStatus,
          selectedAssetVersionId: created.version.id,
          qaReportId,
        },
      });
    }

    const finalItems = await this.db.variantItem.findMany({
      where: { workspaceId: input.workspaceId, variantRunId: runId },
    });
    const status = aggregateVariantRunStatus(
      finalItems.map((i) => i.status as VariantItemStatus),
    ) as VariantRunStatus;
    await this.db.variantRun.update({
      where: { id: runId },
      data: {
        status,
        completedAt: new Date(),
      },
    });

    const detail = await this.getRun(input.workspaceId, runId);
    if (!detail) throw new Error('variant run missing');
    return detail;
  }

  async retryItem(input: {
    workspaceId: string;
    itemId: string;
    requestedByUserId: string;
    scenario?: string;
    visionScenario?: string;
    putObject?: (args: { key: string; body: Buffer; contentType: string }) => Promise<unknown>;
    runQa?: (args: { workspaceId: string; reportId: string }) => Promise<void>;
    produceImage?: () => Promise<FakeVariantImage>;
  }): Promise<VariantItem> {
    const item = await this.db.variantItem.findFirst({
      where: { id: input.itemId, workspaceId: input.workspaceId },
    });
    if (!item) throw new VariantNotFoundError('Variant item not found');
    if (!['FAILED_FINAL', 'FAILED_RETRYABLE', 'QA_BLOCK', 'QA_REVIEW'].includes(item.status)) {
      throw new VariantValidationError(`Cannot retry item in status ${item.status}`);
    }
    const variant = await this.get(input.workspaceId, item.variantId);
    if (!variant) throw new VariantNotFoundError('Variant not found');
    if (!item.variantRunId) throw new VariantValidationError('Item has no variant run');

    // Reset and re-process single item via mini batch semantics
    await this.db.variantItem.update({
      where: { id: item.id },
      data: {
        status: 'QUEUED',
        errorClass: null,
        errorMessage: null,
        selectedAssetVersionId: null,
        qaReportId: null,
      },
    });

    const unitMicro = amountToMicrounits(FAKE_PRIMARY_MODEL.pricing.estimatedUnitCost);
    const attemptKey = `variant-item-retry:${item.id}:${Date.now()}`;
    const scenario = (input.scenario ?? 'SUCCESS').toUpperCase();
    const visionScenario = input.visionScenario ?? 'SUCCESS';

    await this.credits.appendEvent(input.workspaceId, {
      type: 'RESERVE',
      microunits: unitMicro,
      idempotencyKey: reserveIdempotencyKey(attemptKey),
      note: `variant retry reserve ${variant.code}/${item.slot}`,
    });

    if (['AUTH', 'VALIDATION', 'POLICY', 'QUOTA', 'FAIL'].includes(scenario)) {
      await this.credits.appendEvent(input.workspaceId, {
        type: 'REFUND',
        microunits: unitMicro,
        idempotencyKey: refundIdempotencyKey(attemptKey),
        note: `variant retry fail ${scenario}`,
      });
      return this.db.variantItem.update({
        where: { id: item.id },
        data: {
          status: 'FAILED_FINAL',
          errorClass: scenario === 'FAIL' ? 'UNKNOWN' : scenario,
          errorMessage: `Fake provider ${scenario} on retry`,
        },
      });
    }

    const img = input.produceImage
      ? await input.produceImage()
      : { bytes: fakeTinyPngBytes(), width: 1, height: 1 };
    const bytes = img.bytes;
    const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    const created = await this.assets.createGeneratedAssetWithVersion({
      workspaceId: input.workspaceId,
      projectId: variant.projectId,
      createdByUserId: input.requestedByUserId,
      kind: 'GENERATED',
      originalFilename: `variant-retry-${variant.code}-${item.slot}.png`,
      sha256,
      mime: 'image/png',
      width: img.width,
      height: img.height,
      byteSize: bytes.length,
      storageKey: 'pending',
      representationKind: 'ORIGINAL_UPLOAD',
      metadataJson: { variantId: variant.id, retry: true, fake: true },
      primaryParentVersionId: null,
    });
    if (input.putObject) {
      const storageKey = `workspaces/${input.workspaceId}/projects/${variant.projectId}/variants/${variant.code}/${item.slot}/${created.version.id}.png`;
      await input.putObject({ key: storageKey, body: bytes, contentType: 'image/png' });
      await this.db.assetRepresentation.updateMany({
        where: { workspaceId: input.workspaceId, assetVersionId: created.version.id },
        data: { storageKey },
      });
    }
    await this.credits.appendEvent(input.workspaceId, {
      type: 'SETTLE',
      microunits: unitMicro,
      idempotencyKey: settleIdempotencyKey(attemptKey),
      note: `variant retry settle ${variant.code}/${item.slot}`,
    });

    let qaReportId: string | null = null;
    let itemStatus: VariantItemStatus = 'QA_PASS';
    await this.qa.ensureBuiltinRulePack();
    const report = await this.qa.createQueuedReport({
      workspaceId: input.workspaceId,
      projectId: variant.projectId,
      assetVersionId: created.version.id,
      createdByUserId: input.requestedByUserId,
      slot: item.slot,
      visionScenario,
      ocrScenario: 'SUCCESS',
    });
    qaReportId = report.id;
    if (input.runQa) {
      await input.runQa({ workspaceId: input.workspaceId, reportId: report.id });
      const finished = await this.qa.getReport(input.workspaceId, report.id);
      const overall = finished?.overallStatus;
      if (overall === 'BLOCK') itemStatus = 'QA_BLOCK';
      else if (overall === 'REVIEW') itemStatus = 'QA_REVIEW';
      else itemStatus = 'QA_PASS';
    } else {
      const expect = variantLockQaExpectation(visionScenario);
      itemStatus =
        expect.overall === 'BLOCK'
          ? 'QA_BLOCK'
          : expect.overall === 'REVIEW'
            ? 'QA_REVIEW'
            : 'QA_PASS';
      await this.db.qaReport.update({
        where: { id: report.id },
        data: {
          status: 'SUCCEEDED',
          overallStatus: expect.overall,
          completedAt: new Date(),
        },
      });
    }

    const updated = await this.db.variantItem.update({
      where: { id: item.id },
      data: {
        status: itemStatus,
        selectedAssetVersionId: created.version.id,
        qaReportId,
        errorClass: null,
        errorMessage: null,
      },
    });

    // Refresh parent run aggregate
    const siblings = await this.db.variantItem.findMany({
      where: { workspaceId: input.workspaceId, variantRunId: item.variantRunId },
    });
    await this.db.variantRun.update({
      where: { id: item.variantRunId },
      data: {
        status: aggregateVariantRunStatus(siblings.map((s) => s.status as VariantItemStatus)),
        completedAt: new Date(),
      },
    });
    return updated;
  }

  async listPassingExportCandidates(workspaceId: string, variantRunId: string, allowReview = false) {
    const items = await this.db.variantItem.findMany({
      where: { workspaceId, variantRunId },
      include: { variant: true },
      orderBy: [{ slot: 'asc' }, { outputIndex: 'asc' }],
    });
    return items.filter((it) => {
      if (!it.selectedAssetVersionId || !it.qaReportId) return false;
      if (it.status === 'QA_PASS') return true;
      if (allowReview && it.status === 'QA_REVIEW') return true;
      return false;
    });
  }

  async reconcileCredits(workspaceId: string) {
    const account = await this.credits.ensureAccount(workspaceId);
    const events = await this.db.creditLedgerEvent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    const { foldCreditEvents } = await import('@studio/domain');
    const folded = foldCreditEvents(
      events.map((e) => ({
        type: e.type as
          | 'GRANT'
          | 'RESERVE'
          | 'SETTLE'
          | 'REFUND'
          | 'RELEASE'
          | 'ADJUST',
        microunits: Number(e.microunits),
      })),
    );
    const snapshot = {
      availableMicrounits: Number(account.availableMicrounits),
      heldMicrounits: Number(account.heldMicrounits),
      consumedMicrounits: Number(account.consumedMicrounits),
    };
    const drift =
      folded.availableMicrounits !== snapshot.availableMicrounits ||
      folded.heldMicrounits !== snapshot.heldMicrounits ||
      folded.consumedMicrounits !== snapshot.consumedMicrounits;
    return { snapshot, folded, drift, eventCount: events.length };
  }
}

export { normalizeVariantCode };
