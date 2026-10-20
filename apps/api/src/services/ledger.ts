import type { z as zod } from 'zod';

import type {
  holdingSchema,
  transactionListQuerySchema,
  transactionListSchema,
  walletHoldingsSchema,
} from '@my-wallets/contracts';

import { financialDecimal } from '../domain/accounting/decimal.ts';
import { calculatePosition } from '../domain/accounting/position.ts';
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

export function createLedgerService(repository: LedgerRepository) {
  return {
    async holdings(userId: string, walletId: string): Promise<Result<WalletHoldings, ApiFailure>> {
      const snapshot = await repository.readForUser(userId, walletId);
      if (!snapshot) {
        return failure({ code: 'NOT_FOUND' });
      }
      const positions = calculatePositions(snapshot);
      const holdings = positions.map(({ holding }) => holding);
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
      return success({
        walletId: snapshot.id,
        reportingCurrency: snapshot.reportingCurrency,
        remainingCostBasis: remainingCostBasis.toFixed(),
        realizedProfitLoss: realizedProfitLoss.toFixed(),
        lastTransactionDate,
        holdings,
      });
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
      const [position] = calculatePositions(snapshot);
      return position ? success(position.holding) : failure({ code: 'NOT_FOUND' });
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
      const positions = calculatePositions(snapshot);
      const latestIds = new Set(positions.map(({ latest }) => latest.id));
      const saleProfitLoss = new Map<string, string>();
      for (const { accounting } of positions) {
        for (const sale of accounting.sales) {
          saleProfitLoss.set(sale.transactionId, sale.realizedProfitLoss);
        }
      }
      const ordered = snapshot.transactions
        .map((transaction) => ({ transaction, entry: toLedgerEntry(transaction) }))
        .sort((left, right) => compareTransactions(right.entry, left.entry));
      const offset = (query.page - 1) * query.pageSize;
      const transactions = ordered
        .slice(offset, offset + query.pageSize)
        .map(({ transaction }) => ({
          ...toTransactionDto(transaction),
          canDelete: latestIds.has(transaction.id),
          totalAmount: financialDecimal(transaction.quantity.toFixed())
            .times(transaction.unitPrice.toFixed())
            .toFixed(),
          realizedProfitLoss: saleProfitLoss.get(transaction.id) ?? null,
        }));
      return success({
        transactions,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalCount: ordered.length,
          totalPages: Math.ceil(ordered.length / query.pageSize),
        },
      });
    },
  };
}

function calculatePositions(snapshot: LedgerSnapshot) {
  const grouped = new Map<string, SnapshotTransaction[]>();
  for (const transaction of snapshot.transactions) {
    const entries = grouped.get(transaction.symbol) ?? [];
    entries.push(transaction);
    grouped.set(transaction.symbol, entries);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([symbol, transactions]) => {
      const entries = transactions.map(toLedgerEntry).sort(compareTransactions);
      const latest = entries.at(-1);
      const instrument = transactions[0]?.instrument;
      if (!latest || !instrument) {
        throw new Error('A persisted ledger group cannot be empty.');
      }
      const result = calculatePosition(
        { walletId: snapshot.id, symbol, currency: snapshot.reportingCurrency },
        entries,
      );
      if (!result.ok) {
        throw new Error('The persisted ledger is invalid for accounting.');
      }
      const accounting = result.value;
      const holding: Holding = {
        walletId: snapshot.id,
        symbol,
        name: instrument.name,
        exchange: instrument.exchange,
        quoteCurrency: instrument.quoteCurrency,
        quantity: accounting.quantity,
        remainingCostBasis: accounting.remainingCostBasis,
        averageUnitCost: accounting.averageUnitCost,
        realizedProfitLoss: accounting.realizedProfitLoss,
        lastTransactionDate: latest.transactionDate,
      };
      return { holding, accounting, latest };
    });
}
