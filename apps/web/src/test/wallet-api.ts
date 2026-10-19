import type { z as zod } from 'zod';

import type { walletListSchema, walletSummarySchema } from '@my-wallets/contracts';

type WalletSummary = zod.infer<typeof walletSummarySchema>;

export const walletSummary: WalletSummary = {
  id: 'b7e967c0-0b21-46f1-8c60-89e19bb2f840',
  name: 'Long-term investing',
  description: 'Retirement plan',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  reportingCurrency: 'USD',
};

export function walletPage(
  wallets: WalletSummary[] = [],
  page = 1,
  totalCount = wallets.length,
): zod.infer<typeof walletListSchema> {
  return {
    wallets,
    pagination: { page, pageSize: 25, totalCount, totalPages: Math.ceil(totalCount / 25) },
  };
}
