'use client';

/**
 * V2 PR-2 — canvas command layer.
 *
 * All canvas mutations go through POST .../workflows/{wf}/commands (batched,
 * idempotent on batchId) and undo/redo through commands/undo|redo. The hook
 * owns the optimistic-concurrency revision counter (revisionRef is shared
 * with the caller so snapshot etc. can reuse it) and serializes batches on a
 * promise chain so every request carries the latest ifRevision.
 *
 * Batching policy:
 * - applyNow(): drains the debounce queue first (preserving order), then
 *   sends one immediate batch — used for addNode/removeNode/connect/
 *   disconnect/paste/run.
 * - schedule(): accumulates configure/moveNode commands into one batch sent
 *   500ms after the last edit.
 *
 * Rollback policy: the caller passes an optimistic-update rollback callback;
 * it runs on 400 VALIDATION_ERROR and network failures (nothing was applied
 * server-side). On 409 the caller shows the conflict banner instead. Run
 * failures (402 etc., details.commandsApplied === true) do NOT roll back —
 * the graph commands were persisted; only the revision is resynced.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { WorkflowCommand } from '@studio/contracts';
import type { WorkflowGraph } from '@studio/domain';

export type WorkflowDraftPayload = {
  workflowId: string;
  projectId: string;
  name: string;
  revisionNumber: number;
  currentRevisionId: string | null;
  graph: WorkflowGraph;
  updatedAt: string;
  updatedByUserId: string | null;
};

export type AppliedBatch = {
  batchId: string;
  workflowId: string;
  revisionNumber: number;
  name: string;
  graph: WorkflowGraph;
  run?: { id: string; status: string };
};

export type CommandFailure = {
  kind: 'conflict' | 'validation' | 'run-failed' | 'network';
  status: number;
  message: string;
  /** Present when the server reported an authoritative revision (run-failed). */
  revisionNumber?: number;
};

export type CommandResult =
  | { ok: true; batch: AppliedBatch }
  | { ok: false; failure: CommandFailure };

export type UndoRedoResult =
  | { ok: true; draft: WorkflowDraftPayload }
  | { ok: false; kind: 'nothing' | 'conflict' | 'error'; message: string };

const DEBOUNCE_MS = 500;

export function useWorkflowCommands(args: {
  workspaceId: string;
  getWorkflowId: () => string | null;
  revisionRef: MutableRefObject<number>;
  /** Called with the result of debounced (schedule→flush) batches only. */
  onSettled?: (result: CommandResult) => void;
}) {
  const { workspaceId, getWorkflowId, revisionRef } = args;
  const onSettledRef = useRef(args.onSettled);
  onSettledRef.current = args.onSettled;

  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef<WorkflowCommand[]>([]);
  const pendingBatchIdRef = useRef<string | null>(null);
  const pendingRollbackRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = chainRef.current.then(fn, fn);
    chainRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  const sendBatch = useCallback(
    async (commands: WorkflowCommand[], batchId: string): Promise<CommandResult> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        return {
          ok: false,
          failure: { kind: 'network', status: 0, message: '工作流尚未加载' },
        };
      }
      let res: Response;
      try {
        res = await fetch(`/api/workspaces/${workspaceId}/workflows/${workflowId}/commands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ifRevision: revisionRef.current, batchId, commands }),
        });
      } catch {
        return {
          ok: false,
          failure: { kind: 'network', status: 0, message: '网络错误 — 命令未发送' },
        };
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (res.ok) {
        const batch = json as unknown as AppliedBatch;
        revisionRef.current = batch.revisionNumber;
        return { ok: true, batch };
      }
      const err = json?.error as
        | { code?: string; message?: string; details?: Record<string, unknown> }
        | undefined;
      const message = err?.message ?? `请求失败（${res.status}）`;
      if (res.status === 409) {
        return { ok: false, failure: { kind: 'conflict', status: 409, message } };
      }
      // Run-command failure: the graph commands were already persisted.
      if (err?.details?.commandsApplied === true) {
        const revisionNumber =
          typeof err.details.revisionNumber === 'number' ? err.details.revisionNumber : undefined;
        if (revisionNumber !== undefined) revisionRef.current = revisionNumber;
        return {
          ok: false,
          failure: { kind: 'run-failed', status: res.status, message, revisionNumber },
        };
      }
      if (res.status === 400) {
        return { ok: false, failure: { kind: 'validation', status: 400, message } };
      }
      return { ok: false, failure: { kind: 'network', status: res.status, message } };
    },
    [workspaceId, getWorkflowId, revisionRef],
  );

  const drainPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current.length === 0) return null;
    const drained = {
      commands: pendingRef.current,
      batchId: pendingBatchIdRef.current ?? crypto.randomUUID(),
      rollback: pendingRollbackRef.current,
    };
    pendingRef.current = [];
    pendingBatchIdRef.current = null;
    pendingRollbackRef.current = null;
    return drained;
  }, []);

  const applyResultRollback = useCallback((result: CommandResult, rollback: (() => void) | null) => {
    if (result.ok) return;
    if (result.failure.kind === 'validation' || result.failure.kind === 'network') {
      rollback?.();
    }
  }, []);

  const flush = useCallback((): Promise<CommandResult> | null => {
    const drained = drainPending();
    if (!drained) return null;
    return enqueue(async () => {
      const result = await sendBatch(drained.commands, drained.batchId);
      applyResultRollback(result, drained.rollback);
      onSettledRef.current?.(result);
      return result;
    });
  }, [drainPending, sendBatch, applyResultRollback]);

  const schedule = useCallback(
    (commands: WorkflowCommand[], rollback?: () => void) => {
      if (pendingRef.current.length === 0) {
        pendingBatchIdRef.current = crypto.randomUUID();
        pendingRollbackRef.current = rollback ?? null;
      }
      pendingRef.current.push(...commands);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  const applyNow = useCallback(
    (commands: WorkflowCommand[], rollback?: () => void): Promise<CommandResult> => {
      const drained = drainPending();
      return enqueue(async () => {
        const all = drained ? [...drained.commands, ...commands] : commands;
        const batchId = drained?.batchId ?? crypto.randomUUID();
        const result = await sendBatch(all, batchId);
        applyResultRollback(result, drained?.rollback ?? rollback ?? null);
        return result;
      });
    },
    [drainPending, sendBatch, applyResultRollback],
  );

  const postUndoRedo = useCallback(
    async (direction: 'undo' | 'redo'): Promise<UndoRedoResult> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        return { ok: false, kind: 'error', message: '工作流尚未加载' };
      }
      let res: Response;
      try {
        res = await fetch(
          `/api/workspaces/${workspaceId}/workflows/${workflowId}/commands/${direction}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ifRevision: revisionRef.current }),
          },
        );
      } catch {
        return { ok: false, kind: 'error', message: '网络错误 — 请求未发送' };
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (res.ok) {
        const draft = json as unknown as WorkflowDraftPayload;
        revisionRef.current = draft.revisionNumber;
        return { ok: true, draft };
      }
      const err = json?.error as
        | { code?: string; message?: string; details?: { reason?: string } }
        | undefined;
      const message = err?.message ?? `请求失败（${res.status}）`;
      if (res.status === 409 && err?.code === 'WORKFLOW_UNDO_CONFLICT') {
        const reason = err.details?.reason;
        const hint =
          direction === 'undo'
            ? reason === 'ALREADY_UNDONE'
              ? '该批次已撤销过'
              : '没有可撤销的操作'
            : reason === 'NOT_UNDONE'
              ? '该批次不在已撤销状态'
              : '没有可重做的操作';
        return { ok: false, kind: 'nothing', message: hint };
      }
      if (res.status === 409) {
        return { ok: false, kind: 'conflict', message };
      }
      return { ok: false, kind: 'error', message };
    },
    [workspaceId, getWorkflowId, revisionRef],
  );

  const undo = useCallback((): Promise<UndoRedoResult> => {
    const drained = drainPending();
    return enqueue(async () => {
      // Pending debounced edits are the user's most recent action — persist
      // them first so undo below targets that batch.
      if (drained) {
        const result = await sendBatch(drained.commands, drained.batchId);
        if (!result.ok) {
          applyResultRollback(result, drained.rollback);
          onSettledRef.current?.(result);
          return {
            ok: false,
            kind: result.failure.kind === 'conflict' ? 'conflict' : 'error',
            message: result.failure.message,
          } as UndoRedoResult;
        }
      }
      return postUndoRedo('undo');
    });
  }, [drainPending, sendBatch, applyResultRollback, postUndoRedo]);

  const redo = useCallback((): Promise<UndoRedoResult> => {
    const drained = drainPending();
    return enqueue(async () => {
      if (drained) {
        const result = await sendBatch(drained.commands, drained.batchId);
        if (!result.ok) {
          applyResultRollback(result, drained.rollback);
          onSettledRef.current?.(result);
          return {
            ok: false,
            kind: result.failure.kind === 'conflict' ? 'conflict' : 'error',
            message: result.failure.message,
          } as UndoRedoResult;
        }
      }
      return postUndoRedo('redo');
    });
  }, [drainPending, sendBatch, applyResultRollback, postUndoRedo]);

  /** Discard pending debounced commands (used before a full reload). */
  const reset = useCallback(() => {
    void drainPending();
  }, [drainPending]);

  /**
   * An external actor (chat agent) mutated the workflow. Flush any pending
   * debounced commands FIRST (awaited, so the user's unsent local edits are
   * not silently dropped), then sync the optimistic-concurrency revision so
   * the next batch does not 409. Flush failures follow the existing error
   * path (rollback + onSettled inside flush); the revision is synced
   * regardless because the caller applies the authoritative graph.
   */
  const applyExternal = useCallback(
    async (revisionNumber: number): Promise<void> => {
      const pending = flush();
      if (pending) await pending.catch(() => undefined);
      revisionRef.current = revisionNumber;
    },
    [flush, revisionRef],
  );

  return { applyNow, schedule, flush, undo, redo, reset, applyExternal };
}
