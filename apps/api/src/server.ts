import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import autoload from '@fastify/autoload';
import Fastify, { type FastifyServerOptions } from 'fastify';

import { type ApiErrorInput, apiErrorMessages } from '@my-wallets/contracts';

import { apiEnvironment, type ApiEnvironmentInput } from './config/environment.js';
import { mapFailureToResponse } from './http/api-failure.js';
import { getRequestFailure } from './http/request-failure.js';

export interface BuildServerOptions {
  environment?: ApiEnvironmentInput;
  logger?: FastifyServerOptions['logger'];
}

export function buildServer(options: BuildServerOptions = {}) {
  const environment = options.environment ?? apiEnvironment;
  const server = Fastify({
    genReqId: () => randomUUID(),
    trustProxy:
      environment.API_TRUSTED_PROXY_CIDRS.length > 0 ? environment.API_TRUSTED_PROXY_CIDRS : false,
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

  server.decorate('apiEnvironment', environment);

  server.setErrorHandler((error, request, reply) => {
    const failure = getRequestFailure(error);

    if (failure !== undefined) {
      const response = mapFailureToResponse(failure, request.id);

      return reply.code(response.statusCode).send(response.body);
    }

    request.log.error({ err: error }, 'Unhandled request error');

    const response: ApiErrorInput = {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: apiErrorMessages.INTERNAL_SERVER_ERROR,
        requestId: request.id,
      },
    };

    return reply.code(500).send(response);
  });

  const serverDirectory = dirname(fileURLToPath(import.meta.url));

  server.register(autoload, {
    dir: join(serverDirectory, 'plugins'),
    ignorePattern: /\.(test|spec)\.ts$/,
    options: { environment },
  });
  server.register(autoload, {
    dir: join(serverDirectory, 'routes'),
    autoHooks: true,
    matchFilter: /[\\/]index\.(ts|js)$/,
    ignorePattern: /^(?:private(?:\/|$)|.*\.(?:test|spec)\.(?:ts|js)$)/,
    options: { prefix: '/api', environment },
  });
  server.register(autoload, {
    dir: join(serverDirectory, 'routes', 'private'),
    autoHooks: true,
    cascadeHooks: true,
    matchFilter: /[\\/]index\.(ts|js)$/,
    ignorePattern: /\.(test|spec)\.(ts|js)$/,
    options: { prefix: '/api', environment },
  });

  return server;
}
