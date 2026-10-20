import type { LedgerTransaction } from '../../generated/prisma/client.js';
import type { LedgerEntry } from '../domain/accounting/position.ts';

export function toLedgerEntry(entry: Omit<LedgerTransaction, 'description'>): LedgerEntry {
  return {
    id: entry.id,
    walletId: entry.walletId,
    symbol: entry.symbol,
    side: entry.side,
    currency: entry.currency,
    transactionDate: entry.transactionDate.toISOString().slice(0, 10),
    createdAt: entry.createdAt,
    quantity: entry.quantity.toFixed(),
    unitPrice: entry.unitPrice.toFixed(),
  };
}
