import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  apiErrorSchema,
  holdingParamsSchema,
  holdingSchema,
  transactionListQuerySchema,
  transactionListSchema,
  walletHoldingsSchema,
  walletIdParamsSchema,
} from '@my-wallets/contracts';

import { getAuthenticatedUserId } from '../../../http/get-authenticated-user-id.ts';
import { sendResult } from '../../../http/send-result.ts';
import { createLedgerRepository } from '../../../repositories/ledger.ts';
import { createLedgerService } from '../../../services/ledger.ts';

const ledgerRoutes: FastifyPluginCallbackZod = (server, _options, completePluginRegistration) => {
  const ledger = createLedgerService(createLedgerRepository(server.prisma));
  const errors = {
    400: apiErrorSchema,
    401: apiErrorSchema,
    404: apiErrorSchema,
    429: apiErrorSchema,
    500: apiErrorSchema,
  };

  server.get(
    '/:walletId/transactions',
    {
      schema: {
        operationId: 'listTransactions',
        summary: 'Read paginated wallet history, optionally filtered by instrument',
        description:
          'Newest first by transaction date, creation timestamp and id. Exact totals and SELL realized P/L use the complete symbol ledger before pagination. BUY realized P/L is null. canDelete identifies the latest row for each wallet/instrument in this snapshot; DELETE rechecks eligibility under the write lock. An unknown symbol filter returns an empty list.',
        tags: ['Transactions'],
        params: walletIdParamsSchema,
        querystring: transactionListQuerySchema,
        response: { 200: transactionListSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendResult(
        reply,
        await ledger.history(
          getAuthenticatedUserId(request),
          request.params.walletId,
          request.query,
        ),
        request.id,
      ),
  );

  server.get(
    '/:walletId/holdings',
    {
      schema: {
        operationId: 'getWalletHoldings',
        summary: 'Read ledger-only wallet totals and instrument holdings',
        description:
          'A consistent owned-wallet snapshot, ordered by symbol. Includes closed positions with zero quantity and null average cost so realized P/L remains visible. Empty wallets return zero totals, no holdings and a null last transaction date. Amounts are unrounded decimal strings in USD. No live prices, current values, unrealized P/L or provider requests.',
        tags: ['Wallets'],
        params: walletIdParamsSchema,
        response: { 200: walletHoldingsSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendResult(
        reply,
        await ledger.holdings(getAuthenticatedUserId(request), request.params.walletId),
        request.id,
      ),
  );

  server.get(
    '/:walletId/holdings/:symbol',
    {
      schema: {
        operationId: 'getWalletHolding',
        summary: 'Read ledger-only accounting for one instrument in an owned wallet',
        description:
          'Returns remaining quantity, original acquisition cost of remaining FIFO lots, weighted-average remaining unit cost, total realized P/L and last transaction date. Closed positions remain readable. Symbols are case-insensitive. A symbol with no ledger in this wallet returns 404, even when shared instrument metadata exists.',
        tags: ['Wallets'],
        params: holdingParamsSchema,
        response: { 200: holdingSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendResult(
        reply,
        await ledger.holding(
          getAuthenticatedUserId(request),
          request.params.walletId,
          request.params.symbol,
        ),
        request.id,
      ),
  );

  completePluginRegistration();
};

export default ledgerRoutes;
