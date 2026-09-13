import {
  prisma,
  OutboxRepository,
  CreditRepository,
  CreditInsufficientError,
  newId,
  ingestProviderOutputs,
  reconcileOrphanProviderEvents,
} from '@studio/db';
import { S3ObjectStorage } from '@studio/storage';
import {
  attemptStatusForError,
  aggregateRunStatus,
  refundIdempotencyKey,
  settleIdempotencyKey,
  shouldAutoRetry,
  type ProviderErrorClass,
  type GenerationItemStatus,
} from '@studio/domain';
import {
  createImageAdapter,
  resolveProviderPollIntervalMs,
  resolveProviderMaxPolls,
  ProviderAdapterError,
  type NormalizedImageRequest,
} from '@studio/providers';
import {
  normalizeProviderImageOutput,
  shouldNormalizeNodeOutput,
} from '@studio/imaging';
import { createLogger } from '@studio/config';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';

const log = createLogger({ name: 'generation-attempt' });

export type GenerationAttemptJobData = {
  workspaceId: string;
  projectId: string;
  runId: string;
  itemId: string;
  attemptId: string;
};

function adapter() {
  return createImageAdapter();
}

async function emitProgress(
  data: GenerationAttemptJobData,
  type: string,
  payload: Record<string, unknown>,
) {
  await prisma.progressEvent.create({
    data: {
      id: newId(),
      workspaceId: data.workspaceId,
      projectId: data.projectId,
      runId: data.runId,
      attemptId: data.attemptId,
      type,
      payloadJson: payload as never,
    },
  });
}

async function refreshRunStatus(workspaceId: string, runId: string) {
  const run = await prisma.generationRun.findFirst({
    where: { id: runId, workspaceId },
    include: { items: true },
  });
  if (!run) return;
  const cancelRequested = run.status === 'CANCEL_REQUESTED';
  const next = aggregateRunStatus(
    run.items.map((i) => i.status as GenerationItemStatus),
    cancelRequested,
  );
  await prisma.generationRun.update({
    where: { id: runId },
    data: { status: next },
  });
}

export async function handleGenerationAttemptJob(data: GenerationAttemptJobData) {
  const credits = new CreditRepository(prisma);
  const attempt = await prisma.generationAttempt.findFirst({
    where: { id: data.attemptId, workspaceId: data.workspaceId },
    include: { item: true, submission: true },
  });
  if (!attempt) {
    log.warn({ attemptId: data.attemptId }, 'attempt not found');
    return { ok: false as const, reason: 'NOT_FOUND' };
  }

  if (attempt.status === 'SUCCEEDED' || attempt.status === 'FAILED_FINAL') {
    return { ok: true as const, skipped: true, status: attempt.status };
  }

  // Cancel requested before submit
  if (attempt.status === 'CANCEL_REQUESTED' || attempt.item.status === 'CANCEL_REQUESTED') {
    await prisma.generationAttempt.update({
      where: { id: attempt.id },
      data: { status: 'CANCELED' },
    });
    await prisma.generationItem.update({
      where: { id: attempt.itemId },
      data: { status: 'CANCELED' },
    });
    await credits.appendEvent(data.workspaceId, {
      type: 'REFUND',
      microunits: Number(
        (
          await prisma.creditLedgerEvent.findUnique({
            where: {
              workspaceId_idempotencyKey: {
                workspaceId: data.workspaceId,
                idempotencyKey: `reserve:${attempt.id}`,
              },
            },
          })
        )?.microunits ?? 0n,
      ),
      idempotencyKey: refundIdempotencyKey(attempt.id),
      attemptId: attempt.id,
      runId: data.runId,
      note: 'Cancel before submit',
    });
    await refreshRunStatus(data.workspaceId, data.runId);
    await emitProgress(data, 'attempt.canceled', { attemptId: attempt.id });
    return { ok: true as const, status: 'CANCELED' };
  }

  const leaseToken = randomUUID();
  const request = attempt.requestSnapshot as unknown as NormalizedImageRequest;

  let submission = attempt.submission;
  if (!submission) {
    submission = await prisma.providerSubmission.create({
      data: {
        id: newId(),
        workspaceId: data.workspaceId,
        attemptId: attempt.id,
        submissionKey: attempt.idempotencyKey,
        leaseToken,
        heartbeatAt: new Date(),
        status: 'PENDING',
        provider: attempt.provider,
      },
    });
  } else {
    await prisma.providerSubmission.update({
      where: { id: submission.id },
      data: { leaseToken, heartbeatAt: new Date() },
    });
  }

  await prisma.generationAttempt.update({
    where: { id: attempt.id },
    data: { status: 'RUNNING', progress: 5 },
  });
  await prisma.generationItem.update({
    where: { id: attempt.itemId },
    data: { status: 'RUNNING' },
  });
  await prisma.generationRun.updateMany({
    where: { id: data.runId, workspaceId: data.workspaceId, status: { in: ['QUEUED'] } },
    data: { status: 'RUNNING' },
  });
  await emitProgress(data, 'attempt.running', { attemptId: attempt.id, progress: 5 });

  const a = adapter();
  try {
    let subResult;
    try {
      subResult = await a.submit({
        ...request,
        idempotencyKey: attempt.idempotencyKey,
        modelId: attempt.modelId,
      });
    } catch (err) {
      // recover path for QUERYABLE / uncertain submit — not for clear RATE_LIMIT/AUTH/etc.
      const normalized = a.normalizeError(err);
      const mayRecover =
        normalized.errorClass === 'UNKNOWN' ||
        normalized.errorClass === 'TIMEOUT' ||
        normalized.errorClass === 'TRANSIENT';
      if (a.recoverSubmission && mayRecover) {
        const recovered = await a.recoverSubmission(attempt.idempotencyKey);
        if (recovered !== 'NOT_FOUND' && recovered !== 'UNKNOWN') {
          subResult = recovered;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    await prisma.providerSubmission.update({
      where: { id: submission.id },
      data: {
        externalJobId: subResult.externalJobId,
        status:
          subResult.status === 'SUCCEEDED'
            ? 'SUCCEEDED'
            : subResult.status === 'FAILED'
              ? 'FAILED'
              : 'ACCEPTED',
        heartbeatAt: new Date(),
      },
    });

    // W5-A: apply any webhook events that arrived before this submission existed.
    await reconcileOrphanProviderEvents(prisma, attempt.provider, subResult.externalJobId);

    // Poll until terminal (Fake often already SUCCEEDED)
    let status = await a.getStatus(subResult.externalJobId);
    let polls = 0;
    while (
      (status.status === 'QUEUED' || status.status === 'RUNNING') &&
      polls < resolveProviderMaxPolls(process.env)
    ) {
      // Check cancel
      const latest = await prisma.generationAttempt.findFirst({
        where: { id: attempt.id },
      });
      if (latest?.status === 'CANCEL_REQUESTED') {
        const cancel = await a.cancel?.(subResult.externalJobId);
        if (cancel?.lateResultPossible) {
          // mark canceled; late webhook/poll may store LATE_AFTER_CANCEL
          await prisma.generationAttempt.update({
            where: { id: attempt.id },
            data: { status: 'CANCELED' },
          });
          await prisma.generationItem.update({
            where: { id: attempt.itemId },
            data: { status: 'CANCELED' },
          });
          await credits.appendEvent(data.workspaceId, {
            type: 'REFUND',
            microunits: Number(
              (
                await prisma.creditLedgerEvent.findUnique({
                  where: {
                    workspaceId_idempotencyKey: {
                      workspaceId: data.workspaceId,
                      idempotencyKey: `reserve:${attempt.id}`,
                    },
                  },
                })
              )?.microunits ?? 0n,
            ),
            idempotencyKey: refundIdempotencyKey(attempt.id),
            attemptId: attempt.id,
            runId: data.runId,
          });
          await refreshRunStatus(data.workspaceId, data.runId);
          return { ok: true as const, status: 'CANCELED', lateResultPossible: true };
        }
        await a.cancel?.(subResult.externalJobId);
        break;
      }
      await new Promise((r) => setTimeout(r, resolveProviderPollIntervalMs(process.env)));
      status = await a.getStatus(subResult.externalJobId);
      polls += 1;
      await prisma.generationAttempt.update({
        where: { id: attempt.id },
        data: { progress: status.progress ?? 50 },
      });
      await emitProgress(data, 'attempt.progress', {
        attemptId: attempt.id,
        progress: status.progress ?? 50,
      });
    }

    if (status.status === 'SUCCEEDED') {
      const disposition =
        (await prisma.generationAttempt.findFirst({ where: { id: attempt.id } }))?.status ===
        'CANCEL_REQUESTED'
          ? 'LATE_AFTER_CANCEL'
          : status.outputs?.[0]?.mimeType === 'application/octet-stream'
            ? 'CORRUPT'
            : 'CURRENT';

      if (disposition === 'CORRUPT') {
        throw new ProviderAdapterError('VALIDATION', 'Corrupt provider output', 422);
      }

      const snap = request as NormalizedImageRequest & {
        nodeType?: string;
        nodeId?: string;
        referenceAssetVersionIds?: string[];
        inputFingerprint?: string;
        clientMetadata?: { workflowRevisionId?: string };
      };
      const nodeType = snap.nodeType ?? 'generate';
      const nodeId = snap.nodeId ?? attempt.item.nodeId;
      const workflowRevisionId =
        snap.clientMetadata?.workflowRevisionId ??
        (
          await prisma.generationRun.findFirst({
            where: { id: data.runId, workspaceId: data.workspaceId },
          })
        )?.workflowRevisionId;

      let imageVersionIds: string[] = [];
      let maskVersionId: string | null = null;
      if (disposition === 'CURRENT' && workflowRevisionId) {
        const storage = S3ObjectStorage.fromEnv(process.env);
        await storage.ensureBucket().catch(() => undefined);
        const run = await prisma.generationRun.findFirst({
          where: { id: data.runId, workspaceId: data.workspaceId },
        });
        const rawOutputs = (status.outputs ?? []).map((o) => ({
          bytes: Buffer.from(o.bytesBase64 ?? '', 'base64'),
          mimeType: o.mimeType,
          width: o.width,
          height: o.height,
          role: o.role as 'image' | 'mask' | undefined,
        }));
        const outputs = [];
        for (const o of rawOutputs) {
          if (
            shouldNormalizeNodeOutput(nodeType) &&
            o.role !== 'mask' &&
            typeof request.width === 'number' &&
            typeof request.height === 'number'
          ) {
            const norm = await normalizeProviderImageOutput(o.bytes, {
              width: request.width,
              height: request.height,
              format: 'png',
            });
            outputs.push({
              bytes: norm.bytes,
              mimeType: norm.mimeType,
              width: norm.width,
              height: norm.height,
              role: o.role,
            });
          } else {
            outputs.push(o);
          }
        }
        const ingested = await ingestProviderOutputs({
          db: prisma,
          storage,
          workspaceId: data.workspaceId,
          projectId: data.projectId,
          createdByUserId: run?.requestedByUserId ?? data.workspaceId,
          attemptId: attempt.id,
          nodeType,
          workflowRevisionId,
          nodeId,
          inputFingerprint: snap.inputFingerprint ?? attempt.inputFingerprint ?? null,
          parentAssetVersionId: snap.referenceAssetVersionIds?.[0] ?? null,
          outputs,
        });
        imageVersionIds = ingested.imageVersionIds;
        maskVersionId = ingested.maskVersionId;
      }

      const primaryVersionId = imageVersionIds[0] ?? maskVersionId;
      await prisma.generationOutput.create({
        data: {
          id: newId(),
          workspaceId: data.workspaceId,
          attemptId: attempt.id,
          outputIndex: 0,
          assetVersionId: primaryVersionId,
          disposition: disposition as never,
          mimeType: status.outputs?.[0]?.mimeType ?? 'image/png',
          byteSize: status.outputs?.[0]?.bytesBase64
            ? Buffer.from(status.outputs[0].bytesBase64, 'base64').length
            : null,
        },
      });
      // Extra mask output row when present
      if (maskVersionId && imageVersionIds.length > 0) {
        await prisma.generationOutput.create({
          data: {
            id: newId(),
            workspaceId: data.workspaceId,
            attemptId: attempt.id,
            outputIndex: 1,
            assetVersionId: maskVersionId,
            disposition: disposition as never,
            mimeType: 'image/png',
            byteSize: null,
          },
        });
      }

      const actual = status.actualCostMicrounits ?? 0;
      await credits.appendEvent(data.workspaceId, {
        type: 'SETTLE',
        microunits: actual,
        idempotencyKey: settleIdempotencyKey(attempt.id),
        attemptId: attempt.id,
        runId: data.runId,
        note: 'Settle actual provider cost',
      });
      // Release unused hold if settle < reserve (SETTLE already peels held; release remainder)
      const reserve = await prisma.creditLedgerEvent.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: data.workspaceId,
            idempotencyKey: `reserve:${attempt.id}`,
          },
        },
      });
      if (reserve && Number(reserve.microunits) > actual) {
        await credits.appendEvent(data.workspaceId, {
          type: 'RELEASE',
          microunits: Number(reserve.microunits) - actual,
          idempotencyKey: `release:${attempt.id}`,
          attemptId: attempt.id,
          runId: data.runId,
        });
      }

      if (submission) {
        await prisma.providerCostEvent.create({
          data: {
            id: newId(),
            workspaceId: data.workspaceId,
            providerSubmissionId: submission.id,
            type: 'ACTUAL',
            amountNumeric: actual / 1_000_000,
            currency: 'USD',
            settlementKey: `cogs:${attempt.id}`,
          },
        }).catch(() => undefined);
      }

      if (disposition === 'LATE_AFTER_CANCEL') {
        await prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: { status: 'CANCELED', progress: 100 },
        });
        await prisma.generationItem.update({
          where: { id: attempt.itemId },
          data: { status: 'CANCELED' },
        });
      } else {
        await prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: { status: 'SUCCEEDED', progress: 100 },
        });
        await prisma.generationItem.update({
          where: { id: attempt.itemId },
          data: { status: 'SUCCEEDED' },
        });
      }
      await prisma.providerSubmission.update({
        where: { id: submission.id },
        data: { status: 'SUCCEEDED' },
      });
      await refreshRunStatus(data.workspaceId, data.runId);
      await emitProgress(data, 'attempt.succeeded', { attemptId: attempt.id, disposition });
      return { ok: true as const, status: 'SUCCEEDED' };
    }

    if (status.status === 'CANCELED') {
      await prisma.generationAttempt.update({
        where: { id: attempt.id },
        data: { status: 'CANCELED' },
      });
      await prisma.generationItem.update({
        where: { id: attempt.itemId },
        data: { status: 'CANCELED' },
      });
      await credits.appendEvent(data.workspaceId, {
        type: 'REFUND',
        microunits: Number(
          (
            await prisma.creditLedgerEvent.findUnique({
              where: {
                workspaceId_idempotencyKey: {
                  workspaceId: data.workspaceId,
                  idempotencyKey: `reserve:${attempt.id}`,
                },
              },
            })
          )?.microunits ?? 0n,
        ),
        idempotencyKey: refundIdempotencyKey(attempt.id),
        attemptId: attempt.id,
        runId: data.runId,
      });
      await refreshRunStatus(data.workspaceId, data.runId);
      return { ok: true as const, status: 'CANCELED' };
    }

    // Failed from provider status
    const errorClass = (status.errorClass ?? 'UNKNOWN') as ProviderErrorClass;
    return await failAttempt(data, attempt, credits, errorClass, status.errorMessage ?? 'provider failed');
  } catch (err) {
    const normalized = a.normalizeError(err);
    return await failAttempt(
      data,
      attempt,
      credits,
      normalized.errorClass,
      normalized.message,
    );
  }
}

async function failAttempt(
  data: GenerationAttemptJobData,
  attempt: { id: string; itemId: string; autoRetryCount: number },
  credits: CreditRepository,
  errorClass: ProviderErrorClass,
  message: string,
) {
  const nextStatus = attemptStatusForError(errorClass, attempt.autoRetryCount);
  const willRetry = nextStatus === 'FAILED_RETRYABLE';
  await prisma.generationAttempt.update({
    where: { id: attempt.id },
    data: {
      status: nextStatus,
      errorClass,
      errorMessage: message.slice(0, 2000),
      autoRetryCount: shouldAutoRetry(errorClass, attempt.autoRetryCount)
        ? attempt.autoRetryCount + 1
        : attempt.autoRetryCount,
    },
  });
  await prisma.generationItem.update({
    where: { id: attempt.itemId },
    data: { status: nextStatus },
  });

  // Keep the RESERVE hold across same-attempt BullMQ retries (FAILED_RETRYABLE).
  // Refund only on terminal failure so a later settle always has a valid hold.
  // (Creating a new attempt+reserve, or re-reserving on re-entry, are alternatives;
  // this worker reuses the same attemptId on retry.)
  if (!willRetry) {
    await credits.appendEvent(data.workspaceId, {
      type: 'REFUND',
      microunits: Number(
        (
          await prisma.creditLedgerEvent.findUnique({
            where: {
              workspaceId_idempotencyKey: {
                workspaceId: data.workspaceId,
                idempotencyKey: `reserve:${attempt.id}`,
              },
            },
          })
        )?.microunits ?? 0n,
      ),
      idempotencyKey: refundIdempotencyKey(attempt.id),
      attemptId: attempt.id,
      runId: data.runId,
      note: `Refund on ${errorClass}`,
    });
  }

  await refreshRunStatus(data.workspaceId, data.runId);
  await emitProgress(data, 'attempt.failed', {
    attemptId: attempt.id,
    errorClass,
    message,
    status: nextStatus,
  });

  // Surface retryable to BullMQ for RATE_LIMIT/TRANSIENT/TIMEOUT/UNKNOWN
  if (willRetry) {
    const err = new Error(`RETRYABLE:${errorClass}:${message}`);
    (err as Error & { errorClass: string }).errorClass = errorClass;
    throw err;
  }

  return { ok: false as const, status: nextStatus, errorClass };
}

/** Relay PENDING generation outbox rows. */
export async function relayPendingGenerationOutbox(
  queue: Queue<GenerationAttemptJobData>,
  limit = 50,
): Promise<number> {
  const outboxRepo = new OutboxRepository(prisma);
  const pending = await outboxRepo.listPending(limit);
  let n = 0;
  for (const row of pending) {
    if (!row.jobId.startsWith('gen-attempt-')) continue;
    const data = row.payload as GenerationAttemptJobData;
    try {
      await queue.add('generation-attempt', data, {
        jobId: row.jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 6,
        backoff: { type: 'exponential', delay: 1000 },
      });
      await outboxRepo.markPublished(row.workspaceId, row.id);
      n += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists|exists/i.test(msg)) {
        await outboxRepo.markPublished(row.workspaceId, row.id);
        n += 1;
        continue;
      }
      await outboxRepo.bumpAttempt(row.workspaceId, row.id, msg);
      log.warn({ jobId: row.jobId, err: msg }, 'generation outbox relay failed');
    }
  }
  return n;
}

export function payloadHash(raw: Uint8Array): string {
  return createHash('sha256').update(raw).digest('hex');
}
