import { prismaAdapter } from '@better-auth/prisma-adapter';
import { betterAuth } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type {
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { apiErrorMessages } from '@my-wallets/contracts';

import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ApiEnvironmentInput } from '../config/environment.js';
import type { ApiPluginOptions } from '../plugin-options.js';

export function createBetterAuth(prisma: PrismaClient, environment: ApiEnvironmentInput) {
  return betterAuth({
    appName: 'My Wallet',
    baseURL: environment.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: [environment.WEB_ORIGIN],
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    emailAndPassword: { enabled: true },
    rateLimit: {
      enabled: environment.NODE_ENV === 'production' || environment.BETTER_AUTH_RATE_LIMIT_ENABLED,
      storage: 'database',
      max: environment.BETTER_AUTH_RATE_LIMIT_MAX,
      window: environment.BETTER_AUTH_RATE_LIMIT_WINDOW_SECONDS,
      customRules: {
        '/sign-in/email': {
          max: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX,
          window: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_WINDOW_SECONDS,
        },
        '/sign-up/email': {
          max: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX,
          window: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_WINDOW_SECONDS,
        },
        '/forget-password': {
          max: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX,
          window: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_WINDOW_SECONDS,
        },
        '/reset-password': {
          max: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX,
          window: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_WINDOW_SECONDS,
        },
        '/send-verification-email': {
          max: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX,
          window: environment.BETTER_AUTH_CREDENTIAL_RATE_LIMIT_WINDOW_SECONDS,
        },
      },
    },
    advanced: {
      ipAddress: {
        // The auth bridge replaces this header with Fastify's trusted request.ip.
        ipAddressHeaders: ['x-real-ip'],
        ipv6Subnet: 64,
      },
    },
  });
}

type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
type AuthSession = NonNullable<Awaited<ReturnType<BetterAuthInstance['api']['getSession']>>>;

declare module 'fastify' {
  interface FastifyInstance {
    auth: BetterAuthInstance;
    getAuthSession: (request: FastifyRequest) => Promise<AuthSession | null>;
    authenticate: preHandlerAsyncHookHandler;
  }

  interface FastifyRequest {
    authSession: AuthSession | null;
  }
}

const betterAuthPlugin: FastifyPluginCallback<ApiPluginOptions> = (
  server,
  { environment },
  completePluginRegistration,
) => {
  const auth = createBetterAuth(server.prisma, environment);

  server.decorate('auth', auth);
  server.decorateRequest('authSession', null);
  server.decorate('getAuthSession', async (request) =>
    auth.api.getSession({ headers: fromNodeHeaders(request.headers) }),
  );
  server.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await server.getAuthSession(request);

    if (!session) {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: apiErrorMessages.UNAUTHENTICATED,
          requestId: request.id,
        },
      });
    }

    request.authSession = session;
  });

  completePluginRegistration();
};

export default fastifyPlugin(betterAuthPlugin, {
  name: 'api-better-auth',
  fastify: '5.x',
  dependencies: ['api-cors', 'api-prisma'],
});

export type { AuthSession };
