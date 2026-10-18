import { z as zod } from 'zod';

import { createWalletSchema, updateWalletSchema } from '@my-wallets/contracts';

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

const walletSummarySelect = {
  id: true,
  name: true,
  description: true,
  reportingCurrency: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WalletSelect;

export type WalletRecord = Prisma.WalletGetPayload<{ select: typeof walletSummarySelect }>;

export type CreateWalletInput = zod.infer<typeof createWalletSchema>;
export type UpdateWalletInput = zod.infer<typeof updateWalletSchema>;

export function createWalletRepository(prisma: PrismaClient) {
  return {
    async listForUser(userId: string, page: number, pageSize: number) {
      const where = { userId };
      const [wallets, totalCount] = await Promise.all([
        prisma.wallet.findMany({
          where,
          select: walletSummarySelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.wallet.count({ where }),
      ]);

      return { wallets, totalCount };
    },

    findForUser(userId: string, walletId: string) {
      return prisma.wallet.findFirst({
        where: { id: walletId, userId },
        select: walletSummarySelect,
      });
    },

    createForUser(userId: string, input: CreateWalletInput) {
      return prisma.wallet.create({
        data: {
          userId,
          name: input.name,
          description: input.description || null,
          reportingCurrency: input.reportingCurrency,
        },
        select: walletSummarySelect,
      });
    },

    async updateForUser(userId: string, walletId: string, changes: UpdateWalletInput) {
      const [wallet] = await prisma.wallet.updateManyAndReturn({
        where: { id: walletId, userId },
        data: {
          ...(changes.name === undefined ? {} : { name: changes.name }),
          ...(changes.description === undefined
            ? {}
            : { description: changes.description || null }),
        },
        select: walletSummarySelect,
      });

      return wallet ?? null;
    },
  };
}

export type WalletRepository = ReturnType<typeof createWalletRepository>;
