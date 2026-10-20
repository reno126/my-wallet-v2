import type { z as zod } from 'zod';

import type {
  holdingSchema,
  transactionListQuerySchema,
  transactionListSchema,
  walletHoldingsSchema,
} from '@my-wallets/contracts';

import { financialDecimal } from '../domain/accounting/decimal.ts';
import {
  calculatePosition,
  type LedgerEntry,
  type PositionAccounting,
} from '../domain/accounting/position.ts';
import { compareTransactions } from '../domain/transaction-order.ts';
import type { ApiFailure } from '../http/api-failure.ts';
import type { LedgerRepository, LedgerSnapshot } from '../repositories/ledger.ts';
import { toLedgerEntry } from '../repositories/ledger-entry.ts';
import { failure, type Result, success } from '../result.ts';
import { toTransactionDto } from './transaction-dto.ts';

type Holding = zod.infer<typeof holdingSchema>;
type WalletHoldings = zod.infer<typeof walletHoldingsSchema>;
type TransactionList = zod.infer<typeof transactionListSchema>;
type HistoryQuery = zod.infer<typeof transactionListQuerySchema>;
type SnapshotTransaction = LedgerSnapshot['transactions'][number];

interface PreparedTransaction {
  transaction: SnapshotTransaction;
  entry: LedgerEntry;
}

interface ReplayedPosition {
  accounting: PositionAccounting;
  latest: PreparedTransaction;
}

interface ReplayedLedger {
  transactions: PreparedTransaction[];
  positions: ReplayedPosition[];
}

export function createLedgerService(repository: LedgerRepository) {
  return {
    async holdings(userId: string, walletId: string): Promise<Result<WalletHoldings, ApiFailure>> {
      const snapshot = await repository.readForUser(userId, walletId);
      if (!snapshot) {
        return failure({ code: 'NOT_FOUND' });
      }
      const ledger = replayLedger(snapshot);
      return success(buildWalletHoldings(snapshot, ledger.positions));
    },
    async holding(
      userId: string,
      walletId: string,
      symbol: string,
    ): Promise<Result<Holding, ApiFailure>> {
      const snapshot = await repository.readForUser(userId, walletId, symbol.toUpperCase());
      if (!snapshot) {
        return failure({ code: 'NOT_FOUND' });
      }
      const [position] = replayLedger(snapshot).positions;
      return position ? success(toHoldingDto(position)) : failure({ code: 'NOT_FOUND' });
    },
    async history(
      userId: string,
      walletId: string,
      query: HistoryQuery,
    ): Promise<Result<TransactionList, ApiFailure>> {
      const snapshot = await repository.readForUser(userId, walletId, query.symbol?.toUpperCase());
      if (!snapshot) {
        return failure({ code: 'NOT_FOUND' });
      }
      return success(buildTransactionHistory(replayLedger(snapshot), query));
    },
  };
}

function replayLedger(snapshot: LedgerSnapshot): ReplayedLedger {
  const transactions = snapshot.transactions.map((transaction) => ({
    transaction,
    entry: toLedgerEntry(transaction),
  }));
  const grouped = new Map<string, { entries: LedgerEntry[]; latest: PreparedTransaction }>();
  for (const prepared of transactions) {
    const group = grouped.get(prepared.entry.symbol);
    if (group) {
      group.entries.push(prepared.entry);
      if (compareTransactions(prepared.entry, group.latest.entry) > 0) {
        group.latest = prepared;
      }
    } else {
      grouped.set(prepared.entry.symbol, { entries: [prepared.entry], latest: prepared });
    }
  }
  const positions = [...grouped.entries()].map(([symbol, { entries, latest }]) => {
    const result = calculatePosition(
      { walletId: snapshot.id, symbol, currency: snapshot.reportingCurrency },
      entries,
    );
    if (!result.ok) {
      throw new Error('The persisted ledger is invalid for accounting.');
    }
    return { accounting: result.value, latest };
  });
  return { transactions, positions };
}

function toHoldingDto({ accounting, latest }: ReplayedPosition): Holding {
  const instrument = latest.transaction.instrument;
  return {
    walletId: accounting.walletId,
    symbol: accounting.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    quoteCurrency: instrument.quoteCurrency,
    quantity: accounting.quantity,
    remainingCostBasis: accounting.remainingCostBasis,
    averageUnitCost: accounting.averageUnitCost,
    realizedProfitLoss: accounting.realizedProfitLoss,
    lastTransactionDate: latest.entry.transactionDate,
  };
}

function buildWalletHoldings(
  snapshot: LedgerSnapshot,
  positions: readonly ReplayedPosition[],
): WalletHoldings {
  const holdings = positions
    .map(toHoldingDto)
    .sort((left, right) => (left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0));
  let remainingCostBasis = financialDecimal('0');
  let realizedProfitLoss = financialDecimal('0');
  let lastTransactionDate: string | null = null;
  for (const holding of holdings) {
    remainingCostBasis = remainingCostBasis.plus(holding.remainingCostBasis);
    realizedProfitLoss = realizedProfitLoss.plus(holding.realizedProfitLoss);
    if (lastTransactionDate === null || holding.lastTransactionDate > lastTransactionDate) {
      lastTransactionDate = holding.lastTransactionDate;
    }
  }
  return {
    walletId: snapshot.id,
    reportingCurrency: snapshot.reportingCurrency,
    remainingCostBasis: remainingCostBasis.toFixed(),
    realizedProfitLoss: realizedProfitLoss.toFixed(),
    lastTransactionDate,
    holdings,
  };
}

function buildTransactionHistory(ledger: ReplayedLedger, query: HistoryQuery): TransactionList {
  const latestIds = new Set(ledger.positions.map(({ latest }) => latest.entry.id));
  const saleProfitLoss = new Map<string, string>();
  for (const { accounting } of ledger.positions) {
    for (const sale of accounting.sales) {
      saleProfitLoss.set(sale.transactionId, sale.realizedProfitLoss);
    }
  }
  const ordered = [...ledger.transactions].sort((left, right) =>
    compareTransactions(right.entry, left.entry),
  );
  const offset = (query.page - 1) * query.pageSize;
  const transactions = ordered
    .slice(offset, offset + query.pageSize)
    .map(({ transaction, entry }) => ({
      ...toTransactionDto(transaction),
      canDelete: latestIds.has(entry.id),
      totalAmount: financialDecimal(entry.quantity).times(entry.unitPrice).toFixed(),
      realizedProfitLoss: saleProfitLoss.get(entry.id) ?? null,
    }));
  return {
    transactions,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalCount: ordered.length,
      totalPages: Math.ceil(ordered.length / query.pageSize),
    },
  };
}
