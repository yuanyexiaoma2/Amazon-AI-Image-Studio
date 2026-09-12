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

type LockedCreditAccountRow = {
  id: string;
  available_microunits: bigint;
  held_microunits: bigint;
  consumed_microunits: bigint;
};

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
      // Serialize concurrent RESERVE/SETTLE/REFUND on the same account so the
      // controlled snapshot cannot lose updates vs the append-only ledger.
      let locked = await client.$queryRaw<LockedCreditAccountRow[]>`
        SELECT id, available_microunits, held_microunits, consumed_microunits
        FROM credit_accounts
        WHERE workspace_id = ${workspaceId}::uuid
        FOR UPDATE
      `;

      let acctId: string;
      let availableMicrounits: bigint;
      let heldMicrounits: bigint;
      let consumedMicrounits: bigint;

      if (locked[0]) {
        acctId = locked[0].id;
        availableMicrounits = locked[0].available_microunits;
        heldMicrounits = locked[0].held_microunits;
        consumedMicrounits = locked[0].consumed_microunits;
      } else {
        try {
          const created = await client.creditAccount.create({
            data: {
              id: newId(),
              workspaceId,
              currency: 'USD',
              availableMicrounits: 0n,
              heldMicrounits: 0n,
              consumedMicrounits: 0n,
            },
          });
          acctId = created.id;
          availableMicrounits = 0n;
          heldMicrounits = 0n;
          consumedMicrounits = 0n;
        } catch {
          locked = await client.$queryRaw<LockedCreditAccountRow[]>`
            SELECT id, available_microunits, held_microunits, consumed_microunits
            FROM credit_accounts
            WHERE workspace_id = ${workspaceId}::uuid
            FOR UPDATE
          `;
          const row = locked[0];
          if (!row) {
            throw new Error('Credit account missing after concurrent create');
          }
          acctId = row.id;
          availableMicrounits = row.available_microunits;
          heldMicrounits = row.held_microunits;
          consumedMicrounits = row.consumed_microunits;
        }
      }

      const existing = await client.creditLedgerEvent.findUnique({
        where: {
          workspaceId_idempotencyKey: { workspaceId, idempotencyKey: input.idempotencyKey },
        },
      });
      if (existing) {
        return {
          availableMicrounits: Number(availableMicrounits),
          heldMicrounits: Number(heldMicrounits),
          consumedMicrounits: Number(consumedMicrounits),
        };
      }

      const current: CreditLedgerBalances = {
        availableMicrounits: Number(availableMicrounits),
        heldMicrounits: Number(heldMicrounits),
        consumedMicrounits: Number(consumedMicrounits),
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
          accountId: acctId,
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
        where: { id: acctId },
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
