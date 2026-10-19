import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  apiErrorSchema,
  buyTransactionResultSchema,
  createBuyTransactionSchema,
  walletIdParamsSchema,
} from '@my-wallets/contracts';

import { sendResult } from '../../../http/send-result.ts';
import { createBuyTransactionRepository } from '../../../repositories/buy-transactions.ts';
import { createWalletRepository } from '../../../repositories/wallets.ts';
import { createBuyTransactionService } from '../../../services/buy-transactions.ts';

const buyTransactionRoutes: FastifyPluginCallbackZod = (
  server,
  _options,
  completePluginRegistration,
) => {
  const purchases = createBuyTransactionService({
    wallets: createWalletRepository(server.prisma),
    transactions: createBuyTransactionRepository(server.prisma),
    instruments: server.instrumentVerifier,
  });
  server.post(
    '/:walletId/transactions',
    {
      schema: {
        operationId: 'createBuyTransaction',
        summary: 'Record an immutable USD stock purchase and return its resulting share quantity',
        description:
          'Preserves the entered date, quantity and unit price. Verifies stock classification and USD quote currency with one charged profile request before persistence. SELL, editing, transaction deletion and history are not available yet.',
        tags: ['Transactions'],
        params: walletIdParamsSchema,
        body: createBuyTransactionSchema,
        response: {
          201: buyTransactionResultSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          413: apiErrorSchema,
          415: apiErrorSchema,
          422: apiErrorSchema,
          429: apiErrorSchema,
          500: apiErrorSchema,
          502: apiErrorSchema,
          503: apiErrorSchema,
          504: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authSession?.user.id;
      if (userId === undefined)
        throw new Error('Authenticated BUY route reached without a session.');
      const result = await purchases.create(userId, request.params.walletId, request.body);
      if (result.ok) return reply.code(201).send(result.value);
      return sendResult(reply, result, request.id);
    },
  );
  completePluginRegistration();
};

export default buyTransactionRoutes;
