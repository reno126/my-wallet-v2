import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyServerOptions } from 'fastify';

import type { ApiErrorInput } from '@my-wallets/contracts';

import { apiEnvironment, type ApiEnvironmentInput } from './config/environment.js';

export interface BuildServerOptions {
  environment?: ApiEnvironmentInput;
  logger?: FastifyServerOptions['logger'];
}

export function buildServer(options: BuildServerOptions = {}) {
  const environment = options.environment ?? apiEnvironment;
  const server = Fastify({
    genReqId: () => randomUUID(),
    logger:
      options.logger ??
      (environment.NODE_ENV === 'test'
        ? false
        : {
            level: environment.NODE_ENV === 'production' ? 'info' : 'debug',
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers.set-cookie',
              'req.headers.x-api-key',
            ],
          }),
  });

  server.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled request error');

    const response: ApiErrorInput = {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
        requestId: request.id,
      },
    };

    return reply.code(500).send(response);
  });

  server.setNotFoundHandler((request, reply) => {
    const response: ApiErrorInput = {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: request.id,
      },
    };

    return reply.code(404).send(response);
  });

  server.get('/api/health', () => ({ status: 'ok' }));

  return server;
}
