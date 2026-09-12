import type { GenerationRunDetail } from '@studio/db';

export function serializeRun(run: GenerationRunDetail) {
  return {
    id: run.id,
    projectId: run.projectId,
    workflowRevisionId: run.workflowRevisionId,
    status: run.status,
    estimateMicrounits: run.estimateMicrounits,
    currency: run.currency,
    idempotencyKey: run.idempotencyKey,
    scope: run.scopeJson,
    items: run.items.map((item) => ({
      id: item.id,
      nodeId: item.nodeId,
      status: item.status,
      modelKey: item.modelKey,
      attempts: item.attempts.map((a) => {
        const snap = (a.requestSnapshot ?? {}) as Record<string, unknown>;
        return {
          id: a.id,
          attemptNo: a.attemptNo,
          status: a.status,
          provider: a.provider,
          modelId: a.modelId,
          progress: a.progress,
          errorClass: a.errorClass,
          errorMessage: a.errorMessage,
          createdAt: a.createdAt.toISOString(),
          // W5-C: surface executor request specs for Studio / e2e (Fake only fields ok)
          requestSnapshot: {
            operation: snap.operation,
            nodeType: snap.nodeType,
            width: snap.width,
            height: snap.height,
            aspectRatio: snap.aspectRatio,
            resolutionTier: snap.resolutionTier,
            targetRatio: snap.targetRatio,
            placement: snap.placement,
            engineKey: snap.engineKey,
            targetResolution: snap.targetResolution,
            inputFingerprint: snap.inputFingerprint,
          },
        };
      }),
    })),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
