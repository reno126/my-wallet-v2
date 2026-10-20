import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  apiErrorSchema,
  createTransactionSchema,
  transactionResultSchema,
  walletIdParamsSchema,
} from '@my-wallets/contracts';

import { sendResult } from '../../../http/send-result.ts';
import { createTransactionRepository } from '../../../repositories/transactions.ts';
import { createWalletRepository } from '../../../repositories/wallets.ts';
import { createTransactionService } from '../../../services/transactions.ts';

const transactionRoutes: FastifyPluginCallbackZod = (
  server,
  _options,
  completePluginRegistration,
) => {
  const transactions = createTransactionService({
    wallets: createWalletRepository(server.prisma),
    transactions: createTransactionRepository(server.prisma),
    instruments: server.instrumentVerifier,
  });
  server.post(
    '/:walletId/transactions',
    {
      schema: {
        operationId: 'createTransaction',
        summary: 'Record an immutable USD stock trade and return its resulting share quantity',
        description:
          'Preserves the entered date, quantity and unit price. BUY verifies stock classification and USD quote currency with one charged profile request. SELL uses stored instrument metadata without provider calls. Serializes ledger writes and rejects chronological oversells with 409 INSUFFICIENT_HOLDING, including backdated sales that invalidate later sales. Editing, transaction deletion and history are not available yet.',
        tags: ['Transactions'],
        params: walletIdParamsSchema,
        body: createTransactionSchema,
        response: {
          201: transactionResultSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
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
      if (userId === undefined) {
        throw new Error('Authenticated transaction route reached without a session.');
      }
      const result = await transactions.create(userId, request.params.walletId, request.body);
      if (result.ok) {
        return reply.code(201).send(result.value);
      }
      return sendResult(reply, result, request.id);
    },
  );
  completePluginRegistration();
};

export default transactionRoutes;
