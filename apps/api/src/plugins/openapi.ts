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
  dateOnlySchema,
  historicalPriceSchema,
  instrumentSchema,
  instrumentSearchResponseSchema,
  resourceIdSchema,
  timestampSchema,
  transactionListSchema,
  transactionSchema,
  transactionSideSchema,
  updateWalletSchema,
  walletListSchema,
  walletSummarySchema,
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
        { name: 'Transactions', description: 'Authenticated immutable USD stock purchases.' },
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
  zod.globalRegistry.add(createWalletSchema, { id: 'CreateWallet' });
  zod.globalRegistry.add(currencyCodeSchema, { id: 'CurrencyCode' });
  zod.globalRegistry.add(dateOnlySchema, { id: 'DateOnly' });
  zod.globalRegistry.add(instrumentSchema, { id: 'Instrument' });
  zod.globalRegistry.add(historicalPriceSchema, { id: 'HistoricalPrice' });
  zod.globalRegistry.add(instrumentSearchResponseSchema, { id: 'InstrumentSearchResponse' });
  zod.globalRegistry.add(resourceIdSchema, { id: 'ResourceId' });
  zod.globalRegistry.add(timestampSchema, { id: 'Timestamp' });
  zod.globalRegistry.add(transactionListSchema, { id: 'TransactionList' });
  zod.globalRegistry.add(transactionSchema, { id: 'Transaction' });
  zod.globalRegistry.add(transactionSideSchema, { id: 'TransactionSide' });
  zod.globalRegistry.add(updateWalletSchema, { id: 'UpdateWallet' });
  zod.globalRegistry.add(walletListSchema, { id: 'WalletList' });
  zod.globalRegistry.add(walletSummarySchema, { id: 'WalletSummary' });
}

export default fastifyPlugin(openApiPlugin, {
  name: 'api-openapi',
  fastify: '5.x',
  dependencies: ['api-zod'],
});
