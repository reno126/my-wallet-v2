import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z as zod } from 'zod';

import {
  apiErrorSchema,
  createTransactionSchema,
  transactionIdParamsSchema,
  transactionResultSchema,
  walletIdParamsSchema,
} from '@my-wallets/contracts';

import { getAuthenticatedUserId } from '../../../http/get-authenticated-user-id.ts';
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
          'Preserves the entered date, quantity and unit price. BUY verifies stock classification and USD quote currency with one charged profile request. SELL uses stored instrument metadata without provider calls. Serializes creation and latest-only deletion and rejects chronological oversells with 409 INSUFFICIENT_HOLDING, including backdated re-entry that invalidates later sales. Editing and history are not available yet.',
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
      const userId = getAuthenticatedUserId(request);
      const result = await transactions.create(userId, request.params.walletId, request.body);
      if (result.ok) {
        return reply.code(201).send(result.value);
      }
      return sendResult(reply, result, request.id);
    },
  );
  server.delete(
    '/:walletId/transactions/:transactionId',
    {
      schema: {
        operationId: 'deleteLatestTransaction',
        summary: 'Permanently delete the latest transaction for its wallet and instrument',
        description:
          'Locks the owned wallet using the same protocol as creation, verifies latest eligibility by transaction date, creation timestamp and id, then hard-deletes and replays the remaining FIFO ledger atomically. Older entries return 409 CONFLICT without mutation. Missing or inaccessible resources return 404. Replay conflicts roll back deletion with 409 INSUFFICIENT_HOLDING. No audit copy is retained and no provider requests are made. Corrections use normal BUY/SELL creation after deletion.',
        tags: ['Transactions'],
        params: transactionIdParamsSchema,
        response: {
          204: zod
            .null()
            .describe(
              'The latest transaction was permanently deleted and the remaining ledger was replayed.',
            ),
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          413: apiErrorSchema,
          415: apiErrorSchema,
          429: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      const result = await transactions.delete(
        userId,
        request.params.walletId,
        request.params.transactionId,
      );
      if (result.ok) {
        return reply.code(204).send(null);
      }
      return sendResult(reply, result, request.id);
    },
  );
  completePluginRegistration();
};

export default transactionRoutes;
