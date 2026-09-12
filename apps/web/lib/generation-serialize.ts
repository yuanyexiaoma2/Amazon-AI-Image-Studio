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
      attempts: item.attempts.map((a) => ({
        id: a.id,
        attemptNo: a.attemptNo,
        status: a.status,
        provider: a.provider,
        modelId: a.modelId,
        progress: a.progress,
        errorClass: a.errorClass,
        errorMessage: a.errorMessage,
        createdAt: a.createdAt.toISOString(),
      })),
    })),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
