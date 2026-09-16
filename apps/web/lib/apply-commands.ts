import {
  CreateRunRequestSchema,
  defaultNodeConfig,
  isWorkflowNodeConfigType,
  makeApiError,
  parseWorkflowGraphWithConfigs,
  validateNodeConfig,
  type ApiError,
  type WorkflowCommand,
} from '@studio/contracts';
import { applyWorkflowCommands, WorkflowCommandError } from '@studio/domain';
import {
  prisma,
  WorkflowRepository,
  WorkflowConflictError,
  WorkflowNotFoundError,
  WorkflowValidationError,
} from '@studio/db';
import { createRunForRevision } from '@/lib/create-run';
import type { serializeRun } from '@/lib/generation-serialize';
import { isLocalMode } from '@/lib/local-mode';
import { requirePaidSession, SessionGuardError } from '@/lib/session-guard';

export type ApplyCommandsOutcome =
  | {
      ok: true;
      status: 200;
      body: {
        batchId: string;
        workflowId: string;
        revisionNumber: number;
        name: string;
        graph: unknown;
        /** Present when the batch ended with a run command that was created. */
        run?: ReturnType<typeof serializeRun>;
      };
    }
  | { ok: false; status: number; body: ApiError };

/**
 * V2 PR-2/PR-4: shared command-batch pipeline used by the commands route and
 * by the chat agent turn. Applies an ordered command batch atomically
 * (idempotent on batchId), then — when the batch ends with a `run` command —
 * snapshots the new draft and creates a generation run via create-run.
 *
 * `ifRevision` is optional: internal callers (chat agent) omit it to apply
 * against the current draft revision.
 *
 * Run-failure semantics: graph commands are already persisted when run
 * creation fails (intentional — graph ops and billing stay separate). The
 * failure body then carries the run error's status (e.g. 402
 * BUDGET_EXCEEDED) with `error.details` augmented by { batchId,
 * revisionNumber, commandsApplied: true } so the caller can resync.
 */
export async function applyCommandsToWorkflow(args: {
  workspaceId: string;
  workflowId: string;
  /** Defaults to the current draft revisionNumber when omitted. */
  ifRevision?: number;
  batchId: string;
  actorUserId: string;
  commands: WorkflowCommand[];
  requestId: string;
}): Promise<ApplyCommandsOutcome> {
  const { workspaceId, workflowId, batchId, actorUserId, commands, requestId } = args;

  const workflows = new WorkflowRepository(prisma);
  const wf = await workflows.getWithDraft(workspaceId, workflowId);
  if (!wf?.draft) {
    return { ok: false, status: 404, body: makeApiError('NOT_FOUND', 'Workflow not found', requestId) };
  }

  // Idempotent replay: same batchId returns the existing batch + current draft
  // without re-applying commands and without snapshot/run.
  const existingBatch = await workflows.getCommandBatch(workspaceId, workflowId, batchId);
  if (existingBatch) {
    return {
      ok: true,
      status: 200,
      body: {
        batchId: existingBatch.batchId,
        workflowId,
        revisionNumber: wf.draft.revisionNumber,
        name: wf.name,
        graph: workflows.parseGraph(wf.draft),
      },
    };
  }

  const ifRevision = args.ifRevision ?? wf.draft.revisionNumber;

  const last = commands[commands.length - 1];
  const runCommand = last?.type === 'run' ? last : undefined;
  const graphCommands = runCommand ? commands.slice(0, -1) : commands;

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
      return {
        ok: false,
        status: 400,
        body: makeApiError('VALIDATION_ERROR', err.message, requestId, {
          code: err.code,
          commandIndex: err.commandIndex,
        }),
      };
    }
    throw err;
  }

  // Double-check normalization through the contracts graph schema.
  const normalized = parseWorkflowGraphWithConfigs(appliedGraph);
  if (!normalized.ok) {
    return {
      ok: false,
      status: 400,
      body: makeApiError('VALIDATION_ERROR', 'Invalid node configs', requestId, normalized.issues),
    };
  }

  try {
    const { batch, draft, replayed } = await workflows.applyCommandBatch({
      workspaceId,
      workflowId,
      ifRevision,
      batchId,
      actorUserId,
      commands,
      beforeGraph,
      afterGraph: normalized.graph,
      name,
    });

    if (!draft.draft) {
      return {
        ok: false,
        status: 500,
        body: makeApiError('INTERNAL_ERROR', 'Draft missing', requestId),
      };
    }

    // Lost a concurrent same-batchId race: replay semantics, no snapshot/run.
    if (replayed) {
      return {
        ok: true,
        status: 200,
        body: {
          batchId: batch.batchId,
          workflowId,
          revisionNumber: draft.draft.revisionNumber,
          name: draft.name,
          graph: workflows.parseGraph(draft.draft),
        },
      };
    }

    let run: ReturnType<typeof serializeRun> | undefined;
    if (runCommand) {
      // PR-6: browsing/editing is free in local mode, but a run spends credits
      // and calls the provider — require a real signed-in account.
      if (isLocalMode()) {
        try {
          await requirePaidSession();
        } catch (err) {
          if (err instanceof SessionGuardError) {
            return {
              ok: false,
              status: 401,
              body: makeApiError('UNAUTHENTICATED', '生图需要登录账号', requestId, {
                batchId: batch.batchId,
                revisionNumber: draft.draft.revisionNumber,
                commandsApplied: true,
              }),
            };
          }
          throw err;
        }
      }
      const { revision } = await workflows.snapshot({
        workspaceId,
        workflowId,
        ifRevision: draft.draft.revisionNumber,
        createdByUserId: actorUserId,
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
        userId: actorUserId,
        requestId,
      });

      if (!runOutcome.ok) {
        const apiErr = runOutcome.body.error;
        const priorDetails =
          apiErr.details !== null && typeof apiErr.details === 'object'
            ? (apiErr.details as Record<string, unknown>)
            : {};
        return {
          ok: false,
          status: runOutcome.status,
          body: makeApiError(apiErr.code, apiErr.message, requestId, {
            ...priorDetails,
            batchId: batch.batchId,
            revisionNumber: draft.draft.revisionNumber,
            commandsApplied: true,
          }),
        };
      }
      run = runOutcome.body.run;
    }

    return {
      ok: true,
      status: 200,
      body: {
        batchId: batch.batchId,
        workflowId,
        revisionNumber: draft.draft.revisionNumber,
        name: draft.name,
        graph: workflows.parseGraph(draft.draft),
        ...(run !== undefined ? { run } : {}),
      },
    };
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) {
      return { ok: false, status: 404, body: makeApiError('NOT_FOUND', err.message, requestId) };
    }
    if (err instanceof WorkflowConflictError) {
      return {
        ok: false,
        status: 409,
        body: makeApiError('WORKFLOW_REVISION_CONFLICT', err.message, requestId),
      };
    }
    if (err instanceof WorkflowValidationError) {
      return {
        ok: false,
        status: 400,
        body: makeApiError('VALIDATION_ERROR', err.message, requestId, err.details),
      };
    }
    throw err;
  }
}
