import type { z as zod } from 'zod';

import type {
  createBuyTransactionSchema,
  historicalPriceSchema,
  instrumentSchema,
} from '@my-wallets/contracts';

import { walletSummary } from './wallet-api';

export const stock: zod.infer<typeof instrumentSchema> = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  exchange: 'NASDAQ',
  quoteCurrency: 'USD',
};
export const historicalPrice: zod.infer<typeof historicalPriceSchema> = {
  symbol: stock.symbol,
  requestedDate: '2026-01-18',
  effectiveDate: '2026-01-16',
  unitPrice: '230.12345678',
  currency: 'USD',
  source: 'FMP',
  retrievedAt: '2026-01-19T15:00:00.000Z',
  usedPreviousTradingDay: true,
};
export const purchaseInput: zod.infer<typeof createBuyTransactionSchema> = {
  symbol: stock.symbol,
  side: 'BUY',
  transactionDate: historicalPrice.requestedDate,
  quantity: '1.23456789',
  unitPrice: historicalPrice.unitPrice,
  currency: 'USD',
  description: 'Long-term holding',
};
export function purchaseResult(walletId = walletSummary.id, input = purchaseInput) {
  return {
    transaction: {
      ...input,
      id: '4658c2c4-f430-456c-971b-ad3d414575c7',
      walletId,
      createdAt: '2026-01-19T15:00:00.000Z',
    },
    holding: { walletId, symbol: input.symbol, quantity: input.quantity, quoteCurrency: 'USD' },
  };
}
