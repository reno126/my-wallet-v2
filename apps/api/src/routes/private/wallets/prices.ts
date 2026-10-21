import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  apiErrorSchema,
  holdingParamsSchema,
  holdingValuationSchema,
  priceRefreshReceiptSchema,
  priceRefreshRequestSchema,
  walletIdParamsSchema,
  walletRefreshStatusSchema,
  walletValuationSchema,
} from '@my-wallets/contracts';

import { getAuthenticatedUserId } from '../../../http/get-authenticated-user-id.ts';
import { sendResult } from '../../../http/send-result.ts';

const priceRoutes: FastifyPluginCallbackZod = (server, _options, done) => {
  const errors = {
    400: apiErrorSchema,
    401: apiErrorSchema,
    404: apiErrorSchema,
    429: apiErrorSchema,
    500: apiErrorSchema,
  };
  server.get(
    '/:walletId/valuation',
    {
      schema: {
        operationId: 'getWalletValuation',
        summary: 'Read cached current values and FIFO unrealized P/L for an owned wallet',
        description:
          'Returns unrounded USD decimal strings with per-position price dates and freshness. Retains stale prices. If an open position has no price, wallet current value, unrealized P/L and allocation percentages are null. Closed positions need no price and contribute zero current value. Reads never dispatch provider calls or request refreshes.',
        tags: ['Wallets'],
        params: walletIdParamsSchema,
        response: { 200: walletValuationSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendResult(
        reply,
        await server.marketData.valuation(getAuthenticatedUserId(request), request.params.walletId),
        request.id,
      ),
  );
  server.get(
    '/:walletId/valuation/:symbol',
    {
      schema: {
        operationId: 'getWalletHoldingValuation',
        summary: 'Read cached valuation for one holding with its share of the complete wallet',
        tags: ['Wallets'],
        params: holdingParamsSchema,
        response: { 200: holdingValuationSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendResult(
        reply,
        await server.marketData.holdingValuation(
          getAuthenticatedUserId(request),
          request.params.walletId,
          request.params.symbol,
        ),
        request.id,
      ),
  );
  server.get(
    '/:walletId/price-refresh',
    {
      schema: {
        operationId: 'getWalletPriceRefreshStatus',
        summary: 'Read shared refresh state for the owned wallet holdings without scheduling work',
        tags: ['Wallets'],
        params: walletIdParamsSchema,
        response: { 200: walletRefreshStatusSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendResult(
        reply,
        await server.marketData.refreshStatus(
          getAuthenticatedUserId(request),
          request.params.walletId,
        ),
        request.id,
      ),
  );
  server.post(
    '/:walletId/price-refresh',
    {
      schema: {
        operationId: 'requestWalletPriceRefresh',
        summary: 'Idempotently request shared refreshes for stale open holdings',
        description:
          'Call after opening a wallet. Persists intent and returns without waiting for FMP. Repeated requests coalesce by symbol and preserve pending retries, active leases and terminal cooldowns. requestedSymbols reports persisted requests, not completed refreshes or quota reservations. Fresh and closed holdings are skipped. Poll refresh status or reread valuation for completion.',
        tags: ['Wallets'],
        params: walletIdParamsSchema,
        body: priceRefreshRequestSchema,
        response: {
          202: priceRefreshReceiptSchema,
          ...errors,
          403: apiErrorSchema,
          413: apiErrorSchema,
          415: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await server.marketData.requestRefresh(
        getAuthenticatedUserId(request),
        request.params.walletId,
      );
      return result.ok ? reply.code(202).send(result.value) : sendResult(reply, result, request.id);
    },
  );
  done();
};

export default priceRoutes;
