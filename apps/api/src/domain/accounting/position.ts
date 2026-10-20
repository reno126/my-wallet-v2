import type { Decimal } from '@prisma/client/runtime/client';

import { dateOnlySchema, positiveDecimalStringSchema } from '@my-wallets/contracts';

import { failure, type Result, success } from '../../result.ts';
import { compareTransactions, type TransactionOrderKey } from '../transaction-order.ts';
import { financialDecimal } from './decimal.ts';

export interface PositionScope {
  readonly walletId: string;
  readonly symbol: string;
  readonly currency: string;
}

export interface LedgerEntry extends PositionScope, TransactionOrderKey {
  readonly side: 'BUY' | 'SELL';
  readonly quantity: string;
  readonly unitPrice: string;
}

export interface RemainingLot {
  transactionId: string;
  quantity: string;
  unitPrice: string;
  costBasis: string;
  currency: 'USD';
}

export interface SaleAccounting {
  transactionId: string;
  quantity: string;
  unitPrice: string;
  proceeds: string;
  costBasis: string;
  realizedProfitLoss: string;
  currency: 'USD';
}

export interface PositionAccounting {
  walletId: string;
  symbol: string;
  currency: 'USD';
  quantity: string;
  remainingCostBasis: string;
  averageUnitCost: string | null;
  realizedProfitLoss: string;
  lots: RemainingLot[];
  sales: SaleAccounting[];
}

export type AccountingFailure =
  | { code: 'UNSUPPORTED_CURRENCY'; currency: string; transactionId?: string }
  | { code: 'LEDGER_SCOPE_MISMATCH'; transactionId: string }
  | { code: 'INVALID_LEDGER_ENTRY'; transactionId: string }
  | {
      code: 'INSUFFICIENT_HOLDING';
      transactionId: string;
      availableQuantity: string;
      requestedQuantity: string;
    };

interface OpenLot {
  transactionId: string;
  quantity: Decimal;
  unitPrice: Decimal;
}

function validateLedger(
  scope: PositionScope,
  entries: readonly LedgerEntry[],
): AccountingFailure | null {
  if (scope.currency !== 'USD') {
    return { code: 'UNSUPPORTED_CURRENCY', currency: scope.currency };
  }
  const identifiers = new Set<string>();
  for (const entry of entries) {
    if (entry.currency !== 'USD') {
      return { code: 'UNSUPPORTED_CURRENCY', currency: entry.currency, transactionId: entry.id };
    }
    if (entry.walletId !== scope.walletId || entry.symbol !== scope.symbol) {
      return { code: 'LEDGER_SCOPE_MISMATCH', transactionId: entry.id };
    }
    if (
      !entry.id ||
      identifiers.has(entry.id) ||
      !positiveDecimalStringSchema.safeParse(entry.quantity).success ||
      !positiveDecimalStringSchema.safeParse(entry.unitPrice).success ||
      !dateOnlySchema.safeParse(entry.transactionDate).success ||
      entry.transactionDate.startsWith('0000-') ||
      !Number.isFinite(entry.createdAt.getTime())
    ) {
      return { code: 'INVALID_LEDGER_ENTRY', transactionId: entry.id };
    }
    identifiers.add(entry.id);
  }
  return null;
}

export function calculatePosition(
  scope: PositionScope,
  entries: readonly LedgerEntry[],
): Result<PositionAccounting, AccountingFailure> {
  const invalidLedger = validateLedger(scope, entries);
  if (invalidLedger) {
    return failure(invalidLedger);
  }

  let quantity = financialDecimal('0');
  let remainingCostBasis = financialDecimal('0');
  let realizedProfitLoss = financialDecimal('0');
  const lots: OpenLot[] = [];
  const sales: SaleAccounting[] = [];
  let oldestLotIndex = 0;

  for (const entry of [...entries].sort(compareTransactions)) {
    const entryQuantity = financialDecimal(entry.quantity);
    const unitPrice = financialDecimal(entry.unitPrice);
    if (entry.side === 'BUY') {
      lots.push({ transactionId: entry.id, quantity: entryQuantity, unitPrice });
      quantity = quantity.plus(entryQuantity);
      remainingCostBasis = remainingCostBasis.plus(entryQuantity.times(unitPrice));
      continue;
    }

    if (entryQuantity.greaterThan(quantity)) {
      return failure({
        code: 'INSUFFICIENT_HOLDING',
        transactionId: entry.id,
        availableQuantity: quantity.toFixed(),
        requestedQuantity: entryQuantity.toFixed(),
      });
    }
    let unmatchedQuantity = entryQuantity;
    let saleCostBasis = financialDecimal('0');
    while (!unmatchedQuantity.isZero()) {
      const lot = lots[oldestLotIndex];
      if (!lot) {
        throw new Error('FIFO inventory is inconsistent with the available quantity.');
      }
      const matchedQuantity = lot.quantity.lessThan(unmatchedQuantity)
        ? lot.quantity
        : unmatchedQuantity;
      saleCostBasis = saleCostBasis.plus(matchedQuantity.times(lot.unitPrice));
      unmatchedQuantity = unmatchedQuantity.minus(matchedQuantity);
      lot.quantity = lot.quantity.minus(matchedQuantity);
      if (lot.quantity.isZero()) {
        oldestLotIndex += 1;
      }
    }
    const proceeds = entryQuantity.times(unitPrice);
    const saleProfitLoss = proceeds.minus(saleCostBasis);
    quantity = quantity.minus(entryQuantity);
    remainingCostBasis = remainingCostBasis.minus(saleCostBasis);
    realizedProfitLoss = realizedProfitLoss.plus(saleProfitLoss);
    sales.push({
      transactionId: entry.id,
      quantity: entryQuantity.toFixed(),
      unitPrice: unitPrice.toFixed(),
      proceeds: proceeds.toFixed(),
      costBasis: saleCostBasis.toFixed(),
      realizedProfitLoss: saleProfitLoss.toFixed(),
      currency: 'USD',
    });
  }

  return success({
    walletId: scope.walletId,
    symbol: scope.symbol,
    currency: 'USD',
    quantity: quantity.toFixed(),
    remainingCostBasis: remainingCostBasis.toFixed(),
    averageUnitCost: quantity.isZero() ? null : remainingCostBasis.dividedBy(quantity).toFixed(),
    realizedProfitLoss: realizedProfitLoss.toFixed(),
    lots: lots.slice(oldestLotIndex).map((lot) => ({
      transactionId: lot.transactionId,
      quantity: lot.quantity.toFixed(),
      unitPrice: lot.unitPrice.toFixed(),
      costBasis: lot.quantity.times(lot.unitPrice).toFixed(),
      currency: 'USD',
    })),
    sales,
  });
}
