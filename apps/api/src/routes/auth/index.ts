import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z as zod } from 'zod';

import type { ApiPluginOptions } from '../../plugin-options.js';

const authResponseSchema = {
  200: zod.unknown(),
  400: zod.unknown(),
  401: zod.unknown(),
  429: zod.unknown(),
  500: zod.unknown(),
};

const signUpEmailBodySchema = zod
  .object({
    name: zod.string().min(1).max(100),
    email: zod.email(),
    password: zod.string().min(8).max(128),
    callbackURL: zod.string().optional(),
  })
  .passthrough();

const signInEmailBodySchema = zod
  .object({
    email: zod.email(),
    password: zod.string().min(1).max(128),
    callbackURL: zod.string().optional(),
    rememberMe: zod.boolean().optional(),
  })
  .passthrough();

const authRoutes: FastifyPluginCallback<ApiPluginOptions> = (
  server,
  { environment },
  completePluginRegistration,
) => {
  const authCatchAllRateLimit = {
    max: environment.API_AUTH_RATE_LIMIT_MAX,
    timeWindow: environment.API_RATE_LIMIT_TIME_WINDOW_MS,
    ipv6Subnet: 64,
  };

  const forwardAuthRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeaders = fromNodeHeaders(request.headers);

    // Align Better Auth's limiter and session IP tracking with Fastify's trusted proxy result.
    authHeaders.set('x-real-ip', request.ip);

    const authRequest = new Request(new URL(request.url, server.auth.options.baseURL), {
      method: request.method,
      headers: authHeaders,
      ...(request.method === 'POST' && request.body !== undefined
        ? { body: JSON.stringify(request.body) }
        : {}),
    });
    const authResponse = await server.auth.handler(authRequest);

    reply.code(authResponse.status);
    authResponse.headers.forEach((value, name) => {
      if (!['connection', 'content-length', 'set-cookie', 'transfer-encoding'].includes(name)) {
        reply.header(name, value);
      }
    });

    const cookies = authResponse.headers.getSetCookie();

    if (cookies.length > 0) {
      reply.header('set-cookie', cookies);
    }

    const responseBody = await authResponse.text();

    return reply.send(responseBody.length > 0 ? responseBody : null);
  };

  server.get(
    '/get-session',
    {
      config: { rateLimit: authCatchAllRateLimit },
      schema: {
        operationId: 'getAuthSession',
        summary: 'Get the current Better Auth session',
        tags: ['Auth'],
        response: { 200: zod.unknown(), 429: zod.unknown(), 500: zod.unknown() },
      },
    },
    forwardAuthRequest,
  );
  server.post(
    '/sign-up/email',
    {
      config: { rateLimit: authCatchAllRateLimit },
      schema: {
        operationId: 'registerWithEmail',
        summary: 'Register an account with email and password',
        tags: ['Auth'],
        body: signUpEmailBodySchema,
        response: authResponseSchema,
      },
    },
    forwardAuthRequest,
  );
  server.post(
    '/sign-in/email',
    {
      config: { rateLimit: authCatchAllRateLimit },
      schema: {
        operationId: 'signInWithEmail',
        summary: 'Sign in with email and password',
        tags: ['Auth'],
        body: signInEmailBodySchema,
        response: authResponseSchema,
      },
    },
    forwardAuthRequest,
  );
  server.post(
    '/sign-out',
    {
      config: { rateLimit: authCatchAllRateLimit },
      schema: {
        operationId: 'signOut',
        summary: 'End the current Better Auth session',
        tags: ['Auth'],
        response: {
          200: zod.unknown(),
          401: zod.unknown(),
          429: zod.unknown(),
          500: zod.unknown(),
        },
      },
    },
    forwardAuthRequest,
  );

  server.route({
    method: 'GET',
    url: '/*',
    config: { rateLimit: authCatchAllRateLimit },
    schema: { hide: true },
    handler: forwardAuthRequest,
  });
  server.route({
    method: 'POST',
    url: '/*',
    config: { rateLimit: authCatchAllRateLimit },
    schema: { hide: true },
    handler: forwardAuthRequest,
  });
  completePluginRegistration();
};

export default authRoutes;
