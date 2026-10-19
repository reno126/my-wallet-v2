import type { z as zod } from 'zod';

import type {
  walletListQuerySchema,
  walletListSchema,
  walletSummarySchema,
} from '@my-wallets/contracts';

import type { ApiFailure } from '../http/api-failure.js';
import type { WalletRecord, WalletRepository } from '../repositories/wallets.js';
import type { Result } from '../result.js';

type WalletSummary = zod.infer<typeof walletSummarySchema>;
type WalletList = zod.infer<typeof walletListSchema>;
type WalletListQuery = zod.infer<typeof walletListQuerySchema>;

export function createWalletService(repository: WalletRepository) {
  return {
    async list(userId: string, pagination: WalletListQuery): Promise<WalletList> {
      const { wallets, totalCount } = await repository.listForUser(
        userId,
        pagination.page,
        pagination.pageSize,
      );

      return {
        wallets: wallets.map(toWalletSummary),
        pagination: {
          ...pagination,
          totalCount,
          totalPages: Math.ceil(totalCount / pagination.pageSize),
        },
      };
    },

    async create(userId: string, input: Parameters<WalletRepository['createForUser']>[1]) {
      return toWalletSummary(await repository.createForUser(userId, input));
    },

    async read(userId: string, walletId: string): Promise<Result<WalletSummary, ApiFailure>> {
      const wallet = await repository.findForUser(userId, walletId);

      return wallet === null
        ? { ok: false, error: { code: 'NOT_FOUND' } }
        : { ok: true, value: toWalletSummary(wallet) };
    },

    async update(
      userId: string,
      walletId: string,
      changes: Parameters<WalletRepository['updateForUser']>[2],
    ): Promise<Result<WalletSummary, ApiFailure>> {
      const wallet = await repository.updateForUser(userId, walletId, changes);

      return wallet === null
        ? { ok: false, error: { code: 'NOT_FOUND' } }
        : { ok: true, value: toWalletSummary(wallet) };
    },

    async delete(userId: string, walletId: string): Promise<Result<undefined, ApiFailure>> {
      const deleted = await repository.deleteForUser(userId, walletId);

      return deleted ? { ok: true, value: undefined } : { ok: false, error: { code: 'NOT_FOUND' } };
    },
  };
}

function toWalletSummary(wallet: WalletRecord): WalletSummary {
  return {
    id: wallet.id,
    name: wallet.name,
    ...(wallet.description === null ? {} : { description: wallet.description }),
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
    reportingCurrency: wallet.reportingCurrency,
  };
}
