import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  apiErrorSchema,
  createWalletSchema,
  updateWalletSchema,
  walletIdParamsSchema,
  walletListQuerySchema,
  walletListSchema,
  walletSummarySchema,
} from '@my-wallets/contracts';

import { sendResult } from '../../../http/send-result.ts';
import { createWalletRepository } from '../../../repositories/wallets.ts';
import { createWalletService } from '../../../services/wallets.ts';

const walletRoutes: FastifyPluginCallbackZod = (server, _options, completePluginRegistration) => {
  const wallets = createWalletService(createWalletRepository(server.prisma));
  const commonErrorResponses = {
    400: apiErrorSchema,
    401: apiErrorSchema,
    403: apiErrorSchema,
    404: apiErrorSchema,
    429: apiErrorSchema,
    500: apiErrorSchema,
  };

  server.get(
    '/',
    {
      schema: {
        operationId: 'listWallets',
        summary: 'List the authenticated user’s wallets',
        tags: ['Wallets'],
        querystring: walletListQuerySchema,
        response: { 200: walletListSchema, ...commonErrorResponses },
      },
    },
    async (request) => wallets.list(getAuthenticatedUserId(request), request.query),
  );

  server.post(
    '/',
    {
      schema: {
        operationId: 'createWallet',
        summary: 'Create a wallet for the authenticated user',
        tags: ['Wallets'],
        body: createWalletSchema,
        response: {
          201: walletSummarySchema,
          ...commonErrorResponses,
          413: apiErrorSchema,
          415: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const wallet = await wallets.create(getAuthenticatedUserId(request), request.body);

      return reply.code(201).send(wallet);
    },
  );

  server.get(
    '/:walletId',
    {
      schema: {
        operationId: 'getWallet',
        summary: 'Get one of the authenticated user’s wallets',
        tags: ['Wallets'],
        params: walletIdParamsSchema,
        response: { 200: walletSummarySchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const result = await wallets.read(getAuthenticatedUserId(request), request.params.walletId);

      return sendResult(reply, result, request.id);
    },
  );

  server.patch(
    '/:walletId',
    {
      schema: {
        operationId: 'updateWallet',
        summary: 'Update one of the authenticated user’s wallets',
        tags: ['Wallets'],
        params: walletIdParamsSchema,
        body: updateWalletSchema,
        response: {
          200: walletSummarySchema,
          ...commonErrorResponses,
          413: apiErrorSchema,
          415: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await wallets.update(
        getAuthenticatedUserId(request),
        request.params.walletId,
        request.body,
      );

      return sendResult(reply, result, request.id);
    },
  );

  completePluginRegistration();
};

export default walletRoutes;

function getAuthenticatedUserId(request: FastifyRequest): string {
  const userId = request.authSession?.user.id;

  if (userId === undefined) {
    throw new Error('Authenticated wallet route reached without a session.');
  }

  return userId;
}
