import { NextResponse } from 'next/server';
import {
  ApplyWorkflowCommandsRequestSchema,
  CreateRunRequestSchema,
  defaultNodeConfig,
  makeApiError,
  parseWorkflowGraphWithConfigs,
  validateNodeConfig,
  isWorkflowNodeConfigType,
} from '@studio/contracts';
import {
  applyWorkflowCommands,
  WorkflowCommandError,
  WORKFLOW_WRITE_ROLES,
} from '@studio/domain';
import {
  prisma,
  WorkflowRepository,
  WorkflowConflictError,
  WorkflowValidationError,
  WorkflowNotFoundError,
} from '@studio/db';
import { getOrCreateRequestId } from '@/lib/request-id';
import { requireWorkspaceRoles } from '@/lib/workspace-access';
import { createRunForRevision } from '@/lib/create-run';

type Ctx = { params: Promise<{ workspaceId: string; workflowId: string }> };

/**
 * POST /workspaces/{ws}/workflows/{wf}/commands — V2 PR-2 canvas command layer.
 * Applies an ordered command batch atomically (idempotent on batchId), then —
 * when the batch ends with a `run` command — snapshots the new draft and
 * creates a generation run via the shared create-run path.
 *
 * Run-failure semantics: graph commands are already persisted when run
 * creation fails (intentional — graph ops and billing stay separate). The
 * response then carries the run error's status/body (e.g. 402
 * BUDGET_EXCEEDED) with `error.details` augmented by { batchId,
 * revisionNumber, commandsApplied: true } so the client can resync.
 */
export async function POST(request: Request, context: Ctx) {
  const requestId = getOrCreateRequestId(request.headers.get('x-request-id'));
  const { workspaceId, workflowId } = await context.params;
  const access = await requireWorkspaceRoles(workspaceId, requestId, [...WORKFLOW_WRITE_ROLES]);
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(makeApiError('VALIDATION_ERROR', 'Invalid JSON body', requestId), {
      status: 400,
      headers: { 'x-request-id': requestId },
    });
  }

  const parsed = ApplyWorkflowCommandsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid commands payload', requestId, parsed.error.flatten()),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  const workflows = new WorkflowRepository(prisma);
  const wf = await workflows.getWithDraft(workspaceId, workflowId);
  if (!wf?.draft) {
    return NextResponse.json(makeApiError('NOT_FOUND', 'Workflow not found', requestId), {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }

  // Idempotent replay: same batchId returns the existing batch + current draft
  // without re-applying commands and without snapshot/run.
  const existingBatch = await workflows.getCommandBatch(
    workspaceId,
    workflowId,
    parsed.data.batchId,
  );
  if (existingBatch) {
    return NextResponse.json(
      {
        batchId: existingBatch.batchId,
        workflowId,
        revisionNumber: wf.draft.revisionNumber,
        name: wf.name,
        graph: workflows.parseGraph(wf.draft),
      },
      { headers: { 'x-request-id': requestId } },
    );
  }

  const last = parsed.data.commands[parsed.data.commands.length - 1];
  const runCommand = last?.type === 'run' ? last : undefined;
  const graphCommands = runCommand ? parsed.data.commands.slice(0, -1) : parsed.data.commands;

  const beforeGraph = workflows.parseGraph(wf.draft);

  let appliedGraph;
  let name: string | undefined;
  try {
    const result = applyWorkflowCommands(beforeGraph, graphCommands, {
      validateNodeConfig,
      defaultNodeConfig: (nodeType) =>
        isWorkflowNodeConfigType(nodeType)
          ? defaultNodeConfig(nodeType)
          : { schemaVersion: 1 },
    });
    appliedGraph = result.graph;
    name = result.name;
  } catch (err) {
    if (err instanceof WorkflowCommandError) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', err.message, requestId, {
          code: err.code,
          commandIndex: err.commandIndex,
        }),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
    throw err;
  }

  // Double-check normalization through the contracts graph schema.
  const normalized = parseWorkflowGraphWithConfigs(appliedGraph);
  if (!normalized.ok) {
    return NextResponse.json(
      makeApiError('VALIDATION_ERROR', 'Invalid node configs', requestId, normalized.issues),
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  }

  try {
    const { batch, draft, replayed } = await workflows.applyCommandBatch({
      workspaceId,
      workflowId,
      ifRevision: parsed.data.ifRevision,
      batchId: parsed.data.batchId,
      actorUserId: access.session.userId,
      commands: parsed.data.commands,
      beforeGraph,
      afterGraph: normalized.graph,
      name,
    });

    if (!draft.draft) {
      return NextResponse.json(makeApiError('INTERNAL_ERROR', 'Draft missing', requestId), {
        status: 500,
        headers: { 'x-request-id': requestId },
      });
    }

    // Lost a concurrent same-batchId race: replay semantics, no snapshot/run.
    if (replayed) {
      return NextResponse.json(
        {
          batchId: batch.batchId,
          workflowId,
          revisionNumber: draft.draft.revisionNumber,
          name: draft.name,
          graph: workflows.parseGraph(draft.draft),
        },
        { headers: { 'x-request-id': requestId } },
      );
    }

    let run: unknown;
    if (runCommand) {
      const { revision } = await workflows.snapshot({
        workspaceId,
        workflowId,
        ifRevision: draft.draft.revisionNumber,
        createdByUserId: access.session.userId,
      });

      const runRequest = CreateRunRequestSchema.parse({
        scope: runCommand.scope,
        idempotencyKey: runCommand.idempotencyKey,
        budgetLimit: runCommand.budgetLimit ?? null,
        confirmBudget: runCommand.confirmBudget,
        modelKey: runCommand.modelKey,
      });
      const runOutcome = await createRunForRevision({
        workspaceId,
        revisionId: revision.id,
        request: runRequest,
        userId: access.session.userId,
        requestId,
      });

      if (!runOutcome.ok) {
        const apiErr = runOutcome.body.error;
        const priorDetails =
          apiErr.details !== null && typeof apiErr.details === 'object'
            ? (apiErr.details as Record<string, unknown>)
            : {};
        return NextResponse.json(
          makeApiError(apiErr.code, apiErr.message, requestId, {
            ...priorDetails,
            batchId: batch.batchId,
            revisionNumber: draft.draft.revisionNumber,
            commandsApplied: true,
          }),
          { status: runOutcome.status, headers: { 'x-request-id': requestId } },
        );
      }
      run = runOutcome.body.run;
    }

    return NextResponse.json(
      {
        batchId: batch.batchId,
        workflowId,
        revisionNumber: draft.draft.revisionNumber,
        name: draft.name,
        graph: workflows.parseGraph(draft.draft),
        ...(run !== undefined ? { run } : {}),
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) {
      return NextResponse.json(makeApiError('NOT_FOUND', err.message, requestId), {
        status: 404,
        headers: { 'x-request-id': requestId },
      });
    }
    if (err instanceof WorkflowConflictError) {
      return NextResponse.json(
        makeApiError('WORKFLOW_REVISION_CONFLICT', err.message, requestId),
        { status: 409, headers: { 'x-request-id': requestId } },
      );
    }
    if (err instanceof WorkflowValidationError) {
      return NextResponse.json(
        makeApiError('VALIDATION_ERROR', err.message, requestId, err.details),
        { status: 400, headers: { 'x-request-id': requestId } },
      );
    }
    throw err;
  }
}
