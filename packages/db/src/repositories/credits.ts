import type { CreditLedgerEvent, Prisma, PrismaClient } from '@prisma/client';
import {
  applyCreditEvent,
  type CreditEventType,
  type CreditLedgerBalances,
} from '@studio/domain';
import { newId } from '../ids.js';

export class CreditInsufficientError extends Error {
  constructor(message = 'Insufficient credits') {
    super(message);
    this.name = 'CreditInsufficientError';
  }
}

export class CreditRepository {
  constructor(private readonly db: PrismaClient) {}

  async ensureAccount(workspaceId: string, currency = 'USD') {
    const existing = await this.db.creditAccount.findUnique({ where: { workspaceId } });
    if (existing) return existing;
    try {
      return await this.db.creditAccount.create({
        data: {
          id: newId(),
          workspaceId,
          currency,
          availableMicrounits: 0n,
          heldMicrounits: 0n,
          consumedMicrounits: 0n,
        },
      });
    } catch {
      return this.db.creditAccount.findUniqueOrThrow({ where: { workspaceId } });
    }
  }

  /** Seed grant for local/e2e (append-only). Idempotent by key. */
  async grant(
    workspaceId: string,
    microunits: number,
    idempotencyKey: string,
    note?: string,
  ): Promise<CreditLedgerBalances> {
    return this.appendEvent(workspaceId, {
      type: 'GRANT',
      microunits,
      idempotencyKey,
      note,
    });
  }

  async getBalances(workspaceId: string): Promise<CreditLedgerBalances> {
    const account = await this.ensureAccount(workspaceId);
    return {
      availableMicrounits: Number(account.availableMicrounits),
      heldMicrounits: Number(account.heldMicrounits),
      consumedMicrounits: Number(account.consumedMicrounits),
    };
  }

  async appendEvent(
    workspaceId: string,
    input: {
      type: CreditEventType;
      microunits: number;
      idempotencyKey: string;
      attemptId?: string | null;
      runId?: string | null;
      note?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<CreditLedgerBalances> {
    const run = async (client: Prisma.TransactionClient) => {
      const account = await client.creditAccount.findUnique({ where: { workspaceId } });
      const acct =
        account ??
        (await client.creditAccount.create({
          data: {
            id: newId(),
            workspaceId,
            currency: 'USD',
            availableMicrounits: 0n,
            heldMicrounits: 0n,
            consumedMicrounits: 0n,
          },
        }));

      const existing = await client.creditLedgerEvent.findUnique({
        where: {
          workspaceId_idempotencyKey: { workspaceId, idempotencyKey: input.idempotencyKey },
        },
      });
      if (existing) {
        return {
          availableMicrounits: Number(acct.availableMicrounits),
          heldMicrounits: Number(acct.heldMicrounits),
          consumedMicrounits: Number(acct.consumedMicrounits),
        };
      }

      const current: CreditLedgerBalances = {
        availableMicrounits: Number(acct.availableMicrounits),
        heldMicrounits: Number(acct.heldMicrounits),
        consumedMicrounits: Number(acct.consumedMicrounits),
      };

      let next: CreditLedgerBalances;
      try {
        next = applyCreditEvent(current, {
          type: input.type,
          microunits: input.microunits,
        });
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('INSUFFICIENT')) {
          throw new CreditInsufficientError(e.message);
        }
        throw e;
      }

      await client.creditLedgerEvent.create({
        data: {
          id: newId(),
          workspaceId,
          accountId: acct.id,
          type: input.type,
          microunits: BigInt(Math.abs(input.microunits)),
          idempotencyKey: input.idempotencyKey,
          attemptId: input.attemptId ?? null,
          runId: input.runId ?? null,
          note: input.note ?? null,
        },
      });

      // Controlled snapshot update only after append — never silent naked mutation.
      await client.creditAccount.update({
        where: { id: acct.id },
        data: {
          availableMicrounits: BigInt(next.availableMicrounits),
          heldMicrounits: BigInt(next.heldMicrounits),
          consumedMicrounits: BigInt(next.consumedMicrounits),
        },
      });

      return next;
    };

    if (tx) return run(tx);
    return this.db.$transaction((t) => run(t));
  }

  async listEvents(workspaceId: string, limit = 50): Promise<CreditLedgerEvent[]> {
    return this.db.creditLedgerEvent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
