import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z as zod } from 'zod';

const authResponseSchema = {
  200: zod.unknown(),
  400: zod.unknown(),
  401: zod.unknown(),
  429: zod.unknown(),
  500: zod.unknown(),
};

const signUpEmailBodySchema = zod
  .object({
    name: zod.string().min(1),
    email: zod.email(),
    password: zod.string().min(8),
    callbackURL: zod.string().optional(),
  })
  .passthrough();

const signInEmailBodySchema = zod
  .object({
    email: zod.email(),
    password: zod.string().min(1),
    callbackURL: zod.string().optional(),
    rememberMe: zod.boolean().optional(),
  })
  .passthrough();

const authRoutes: FastifyPluginCallback = (server, _pluginOptions, completePluginRegistration) => {
  const forwardAuthRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    const authRequest = new Request(new URL(request.url, server.auth.options.baseURL), {
      method: request.method,
      headers: fromNodeHeaders(request.headers),
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
    schema: { hide: true },
    handler: forwardAuthRequest,
  });
  server.route({
    method: 'POST',
    url: '/*',
    schema: { hide: true },
    handler: forwardAuthRequest,
  });
  completePluginRegistration();
};

export default authRoutes;
