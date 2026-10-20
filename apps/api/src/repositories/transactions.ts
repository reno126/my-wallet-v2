import type {
  CurrencyCode,
  LedgerTransaction,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';
import {
  calculatePosition,
  type LedgerEntry,
  type PositionAccounting,
  type PositionScope,
} from '../domain/accounting/position.ts';
import type { VerifiedInstrument } from '../domain/instrument.ts';
import type { CreateTransactionCommand } from '../domain/transaction.ts';
import { compareTransactions } from '../domain/transaction-order.ts';
import type { ApiFailure } from '../http/api-failure.js';
import { failure, type Result, success } from '../result.ts';
import { toLedgerEntry } from './ledger-entry.ts';

export interface PersistedTransaction {
  transaction: LedgerTransaction;
  holdingQuantity: string;
  quoteCurrency: CurrencyCode;
}

// Prisma rolls back interactive transactions only on rejection. Keep this internal;
// expected ledger conflicts still cross the repository boundary as Result failures.
class InsufficientHoldingError extends Error {}

export function createTransactionRepository(prisma: PrismaClient) {
  return {
    createForUser(
      userId: string,
      walletId: string,
      input: CreateTransactionCommand,
    ): Promise<Result<PersistedTransaction, ApiFailure>> {
      return withLockedWallet(userId, walletId, async (database, reportingCurrency) => {
        const prepared = await prepareInstrumentForWrite(database, input, reportingCurrency);
        if (!prepared.ok) {
          return prepared;
        }
        const instrument = prepared.value;
        const transaction = await database.ledgerTransaction.create({
          data: {
            walletId,
            symbol: instrument.symbol,
            side: input.side,
            transactionDate: new Date(`${input.transactionDate}T00:00:00.000Z`),
            quantity: input.quantity,
            unitPrice: input.unitPrice,
            currency: input.currency,
            description: input.description ?? null,
          },
        });
        const scope = {
          walletId: transaction.walletId,
          symbol: instrument.symbol,
          currency: reportingCurrency,
        };
        const position = replayPosition(scope, await readLedger(database, scope));
        return success({
          transaction,
          holdingQuantity: position.quantity,
          quoteCurrency: instrument.quoteCurrency,
        });
      });
    },
    deleteForUser(
      userId: string,
      walletId: string,
      transactionId: string,
    ): Promise<Result<undefined, ApiFailure>> {
      return withLockedWallet(userId, walletId, async (database, reportingCurrency) => {
        const target = await database.ledgerTransaction.findFirst({
          where: { id: transactionId, walletId },
        });
        if (!target) {
          return failure({ code: 'NOT_FOUND' });
        }
        const scope = {
          walletId: target.walletId,
          symbol: target.symbol,
          currency: reportingCurrency,
        };
        const ledger = await readLedger(database, scope);
        const targetEntry = toLedgerEntry(target);
        if (ledger.some((entry) => compareTransactions(entry, targetEntry) > 0)) {
          return failure({ code: 'CONFLICT' });
        }
        await database.ledgerTransaction.delete({ where: { id: target.id, walletId } });
        // The shared wallet lock keeps this immutable snapshot stable until commit.
        replayPosition(
          scope,
          ledger.filter((entry) => entry.id !== target.id),
        );
        return success(undefined);
      });
    },
  };

  async function withLockedWallet<Value>(
    userId: string,
    walletId: string,
    write: (
      database: Prisma.TransactionClient,
      reportingCurrency: CurrencyCode,
    ) => Promise<Result<Value, ApiFailure>>,
  ): Promise<Result<Value, ApiFailure>> {
    try {
      return await prisma.$transaction(
        async (database) => {
          const [wallet] = await database.$queryRaw<{ reportingCurrency: CurrencyCode }[]>`
            SELECT "reportingCurrency" FROM "wallet"
            WHERE "id" = ${walletId}::uuid AND "userId" = ${userId}
            FOR UPDATE
          `;
          if (!wallet) {
            return failure({ code: 'NOT_FOUND' });
          }
          return write(database, wallet.reportingCurrency);
        },
        { isolationLevel: 'ReadCommitted' },
      );
    } catch (error) {
      if (error instanceof InsufficientHoldingError) {
        return failure({ code: 'INSUFFICIENT_HOLDING' });
      }
      throw error;
    }
  }
}

export type TransactionRepository = ReturnType<typeof createTransactionRepository>;

async function prepareInstrumentForWrite(
  database: Prisma.TransactionClient,
  command: CreateTransactionCommand,
  reportingCurrency: CurrencyCode,
): Promise<Result<VerifiedInstrument, ApiFailure>> {
  const instrument =
    command.side === 'BUY'
      ? command.instrument
      : await database.instrument.findUnique({ where: { symbol: command.symbol } });
  if (!instrument) {
    return failure({ code: 'INSUFFICIENT_HOLDING' });
  }
  if (instrument.symbol !== command.symbol) {
    throw new Error('The verified instrument does not match the requested symbol.');
  }
  if (reportingCurrency !== command.currency || instrument.quoteCurrency !== command.currency) {
    return failure({ code: 'CURRENCY_MISMATCH' });
  }
  if (command.side === 'BUY') {
    await database.instrument.upsert({
      where: { symbol: instrument.symbol },
      create: instrument,
      update: { name: instrument.name, exchange: instrument.exchange },
    });
  }
  return success(instrument);
}

async function readLedger(
  database: Prisma.TransactionClient,
  scope: PositionScope,
): Promise<LedgerEntry[]> {
  const ledger = await database.ledgerTransaction.findMany({
    where: { walletId: scope.walletId, symbol: scope.symbol },
    omit: { description: true },
  });
  return ledger.map(toLedgerEntry);
}

function replayPosition(scope: PositionScope, ledger: readonly LedgerEntry[]): PositionAccounting {
  const position = calculatePosition(scope, ledger);
  if (!position.ok) {
    if (position.error.code === 'INSUFFICIENT_HOLDING') {
      throw new InsufficientHoldingError();
    }
    throw new Error('The persisted ledger is invalid for accounting.');
  }
  return position.value;
}
