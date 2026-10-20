import { http, HttpResponse } from 'msw';
import type { z as zod } from 'zod';

import type {
  holdingSchema,
  transactionListSchema,
  walletHoldingsSchema,
} from '@my-wallets/contracts';

import { walletSummary } from './wallet-api';

type Holding = zod.infer<typeof holdingSchema>;
type TransactionHistory = zod.infer<typeof transactionListSchema>;
type WalletHoldings = zod.infer<typeof walletHoldingsSchema>;

export const ledgerHolding: Holding = {
  walletId: walletSummary.id,
  symbol: 'AAPL',
  name: 'Apple Inc.',
  exchange: 'NASDAQ',
  quoteCurrency: 'USD',
  quantity: '1.5',
  remainingCostBasis: '15',
  averageUnitCost: '10',
  realizedProfitLoss: '2.5',
  lastTransactionDate: '2026-01-17',
};

export const ledgerHistory: TransactionHistory = {
  transactions: [
    {
      id: '4658c2c4-f430-456c-971b-ad3d414575c7',
      walletId: walletSummary.id,
      symbol: 'AAPL',
      side: 'SELL',
      transactionDate: '2026-01-17',
      quantity: '0.5',
      unitPrice: '15',
      currency: 'USD',
      createdAt: '2026-01-19T15:00:01.000Z',
      canDelete: true,
      totalAmount: '7.5',
      realizedProfitLoss: '2.5',
      description: 'Partial sale',
    },
    {
      id: '5ac1da92-c296-4791-9748-51e0b9042613',
      walletId: walletSummary.id,
      symbol: 'AAPL',
      side: 'BUY',
      transactionDate: '2026-01-16',
      quantity: '2',
      unitPrice: '10',
      currency: 'USD',
      createdAt: '2026-01-19T15:00:00.000Z',
      canDelete: false,
      totalAmount: '20',
      realizedProfitLoss: null,
    },
  ],
  pagination: { page: 1, pageSize: 25, totalCount: 2, totalPages: 1 },
};

export function walletHoldings(
  holdings: Holding[] = [ledgerHolding],
  walletId = walletSummary.id,
): WalletHoldings {
  const holding = holdings[0];
  return {
    walletId,
    reportingCurrency: 'USD',
    remainingCostBasis: holding?.remainingCostBasis ?? '0',
    realizedProfitLoss: holding?.realizedProfitLoss ?? '0',
    lastTransactionDate: holding?.lastTransactionDate ?? null,
    holdings,
  };
}

export function emptyHistory(): TransactionHistory {
  return { transactions: [], pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 } };
}

export function emptyLedgerHandlers(walletsEndpoint: string) {
  return [
    http.get(`${walletsEndpoint}/:walletId/holdings`, ({ params }) =>
      HttpResponse.json(walletHoldings([], String(params['walletId']))),
    ),
    http.get(`${walletsEndpoint}/:walletId/transactions`, () => HttpResponse.json(emptyHistory())),
  ];
}
