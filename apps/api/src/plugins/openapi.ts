import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';
import { z as zod } from 'zod';

import {
  apiErrorSchema,
  authSessionSchema,
  authUserSchema,
  buyTransactionResultSchema,
  createBuyTransactionSchema,
  createTransactionSchema,
  createWalletSchema,
  currencyCodeSchema,
  currentPriceSchema,
  dateOnlySchema,
  historicalPriceSchema,
  holdingSchema,
  holdingValuationSchema,
  instrumentSchema,
  instrumentSearchResponseSchema,
  priceRefreshReceiptSchema,
  providerQuotaStatusSchema,
  resourceIdSchema,
  timestampSchema,
  transactionHistoryEntrySchema,
  transactionListSchema,
  transactionResultSchema,
  transactionSchema,
  transactionSideSchema,
  updateWalletSchema,
  walletHoldingsSchema,
  walletListSchema,
  walletRefreshStatusSchema,
  walletSummarySchema,
  walletValuationSchema,
} from '@my-wallets/contracts';

registerPublicSchemas();

const openApiPlugin: FastifyPluginAsync = async (server) => {
  await server.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'My Wallet API',
        description:
          'HTTP API for managing private investment wallets. Rate-limited responses include Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers.',
        version: '1.0.0',
      },
      servers: [{ url: '/api' }],
      tags: [
        {
          name: 'Market data',
          description: 'Authenticated shared refresh and tracked request budget status.',
        },
        {
          name: 'Transactions',
          description: 'Authenticated immutable USD stock purchases and sales.',
        },
        { name: 'Health', description: 'API liveness and readiness probes.' },
        {
          name: 'Instruments',
          description:
            'Authenticated instrument discovery and historical USD closing prices. Responses use Cache-Control: no-store.',
        },
        {
          name: 'Wallets',
          description:
            'Authenticated wallet lifecycle operations. All wallet responses use Cache-Control: no-store.',
        },
      ],
    },
    transform: (transformOptions) => {
      const transformedRoute = jsonSchemaTransform(transformOptions);
      const normalizedUrl = transformedRoute.url.replace(/\/+$/, '') || '/';

      return { ...transformedRoute, url: normalizedUrl };
    },
    transformObject: jsonSchemaTransformObject,
  });

  await server.register(swaggerUi, {
    routePrefix: '/documentation',
    staticCSP: true,
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
};

function registerPublicSchemas() {
  zod.globalRegistry.add(apiErrorSchema, { id: 'ApiError' });
  zod.globalRegistry.add(authSessionSchema, { id: 'AuthSession' });
  zod.globalRegistry.add(authUserSchema, { id: 'AuthUser' });
  zod.globalRegistry.add(createTransactionSchema, { id: 'CreateTransaction' });
  zod.globalRegistry.add(createBuyTransactionSchema, { id: 'CreateBuyTransaction' });
  zod.globalRegistry.add(buyTransactionResultSchema, { id: 'BuyTransactionResult' });
  zod.globalRegistry.add(transactionResultSchema, { id: 'TransactionResult' });
  zod.globalRegistry.add(createWalletSchema, { id: 'CreateWallet' });
  zod.globalRegistry.add(currencyCodeSchema, { id: 'CurrencyCode' });
  zod.globalRegistry.add(dateOnlySchema, { id: 'DateOnly' });
  zod.globalRegistry.add(instrumentSchema, { id: 'Instrument' });
  zod.globalRegistry.add(historicalPriceSchema, { id: 'HistoricalPrice' });
  zod.globalRegistry.add(holdingSchema, { id: 'Holding' });
  zod.globalRegistry.add(currentPriceSchema, { id: 'CurrentPrice' });
  zod.globalRegistry.add(holdingValuationSchema, { id: 'HoldingValuation' });
  zod.globalRegistry.add(walletValuationSchema, { id: 'WalletValuation' });
  zod.globalRegistry.add(walletRefreshStatusSchema, { id: 'WalletRefreshStatus' });
  zod.globalRegistry.add(priceRefreshReceiptSchema, { id: 'PriceRefreshReceipt' });
  zod.globalRegistry.add(providerQuotaStatusSchema, { id: 'ProviderQuotaStatus' });
  zod.globalRegistry.add(instrumentSearchResponseSchema, { id: 'InstrumentSearchResponse' });
  zod.globalRegistry.add(resourceIdSchema, { id: 'ResourceId' });
  zod.globalRegistry.add(timestampSchema, { id: 'Timestamp' });
  zod.globalRegistry.add(transactionListSchema, { id: 'TransactionList' });
  zod.globalRegistry.add(transactionHistoryEntrySchema, { id: 'TransactionHistoryEntry' });
  zod.globalRegistry.add(transactionSchema, { id: 'Transaction' });
  zod.globalRegistry.add(transactionSideSchema, { id: 'TransactionSide' });
  zod.globalRegistry.add(updateWalletSchema, { id: 'UpdateWallet' });
  zod.globalRegistry.add(walletListSchema, { id: 'WalletList' });
  zod.globalRegistry.add(walletHoldingsSchema, { id: 'WalletHoldings' });
  zod.globalRegistry.add(walletSummarySchema, { id: 'WalletSummary' });
}

export default fastifyPlugin(openApiPlugin, {
  name: 'api-openapi',
  fastify: '5.x',
  dependencies: ['api-zod'],
});
