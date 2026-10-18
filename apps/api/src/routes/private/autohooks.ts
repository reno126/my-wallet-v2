import type { FastifyInstance, FastifyPluginCallback, FastifyRequest } from 'fastify';

import { type ApiErrorInput, apiErrorMessages } from '@my-wallets/contracts';

export function registerPrivateRouteHooks(
  server: FastifyInstance,
  environment = server.apiEnvironment,
): void {
  server.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');

    return payload;
  });

  // Keep this separate from the global onRequest limiter so it can run after session resolution.
  const authenticatedUserRateLimit = server.createRateLimit({
    max: environment.API_AUTHENTICATED_RATE_LIMIT_MAX,
    timeWindow: environment.API_RATE_LIMIT_TIME_WINDOW_MS,
    ipv6Subnet: 64,
    keyGenerator: (request) => {
      const userId = request.authSession?.user.id;

      return userId === undefined ? `ip:${request.ip}` : `user:${userId}`;
    },
  });

  server.addHook('preHandler', server.authenticate);

  server.addHook('preHandler', async (request, reply) => {
    if (isSafeMethod(request.method) || hasTrustedMutationOrigin(request, environment.WEB_ORIGIN)) {
      return;
    }

    const forbiddenResponse: ApiErrorInput = {
      error: {
        code: 'FORBIDDEN',
        message: apiErrorMessages.FORBIDDEN,
        requestId: request.id,
      },
    };

    return reply.code(403).send(forbiddenResponse);
  });

  server.addHook('preHandler', async (request, reply) => {
    const rateLimit = await authenticatedUserRateLimit(request);

    if (rateLimit.isAllowed || !rateLimit.isExceeded) {
      return;
    }

    const rateLimitedResponse: ApiErrorInput = {
      error: {
        code: 'RATE_LIMITED',
        message: apiErrorMessages.RATE_LIMITED,
        requestId: request.id,
      },
    };

    return reply.header('retry-after', rateLimit.ttlInSeconds).code(429).send(rateLimitedResponse);
  });
}

const privateRouteHooks: FastifyPluginCallback = (server, _options, completePluginRegistration) => {
  registerPrivateRouteHooks(server);
  completePluginRegistration();
};

export default privateRouteHooks;

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function hasTrustedMutationOrigin(request: FastifyRequest, trustedOrigin: string): boolean {
  const origin = request.headers.origin;

  if (origin !== undefined) {
    return origin === trustedOrigin;
  }

  const referer = request.headers.referer;

  if (referer === undefined) {
    return false;
  }

  try {
    const parsedReferer = new URL(referer);

    return (
      ['http:', 'https:'].includes(parsedReferer.protocol) &&
      parsedReferer.username.length === 0 &&
      parsedReferer.password.length === 0 &&
      parsedReferer.origin === trustedOrigin
    );
  } catch {
    return false;
  }
}
