import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import { z as zod } from 'zod';

import { apiErrorMessages, apiErrorSchema } from '@my-wallets/contracts';

import { createTestServer, type TestServer } from '../../test-support/create-test-server.js';
import { registerPrivateRouteHooks } from '../routes/private/autohooks.js';

describe('private API authorization and abuse controls', () => {
  let server: TestServer | undefined;
  const registeredEmails: string[] = [];

  afterEach(async () => {
    const testServer = server;
    const testEmails = [...registeredEmails];
    server = undefined;
    registeredEmails.length = 0;

    try {
      if (testServer?.hasDecorator('prisma')) {
        await testServer.prisma.rateLimit.deleteMany();

        if (testEmails.length > 0) {
          await testServer.prisma.user.deleteMany({ where: { email: { in: testEmails } } });
        }
      }
    } finally {
      await testServer?.close();
    }
  });

  it('requires a session for private routes and derives identity from that session', async () => {
    const testServer = createTestServer();
    server = testServer;
    registerProtectedTestRoutes(testServer);

    const unauthenticatedResponse = await testServer.inject({
      method: 'GET',
      url: '/api/test-private/wallets',
    });

    const unauthenticatedError = apiErrorSchema.parse(unauthenticatedResponse.json()).error;

    expect(unauthenticatedResponse.statusCode).toBe(401);
    expect(unauthenticatedError.code).toBe('UNAUTHENTICATED');
    expect(unauthenticatedError.message).toBe(apiErrorMessages.UNAUTHENTICATED);
    expect(unauthenticatedError.requestId).toEqual(expect.any(String));

    const email = await registerUser(testServer, registeredEmails);
    const cookies = await getSessionCookie(testServer, email);
    const authenticatedResponse = await testServer.inject({
      method: 'GET',
      url: '/api/test-private/wallets?userId=attacker-selected-id',
      headers: { cookie: cookies, 'x-user-id': 'attacker-selected-id' },
    });
    const authenticatedBody: unknown = authenticatedResponse.json();
    const authenticatedResult = zod.object({ userId: zod.string() }).parse(authenticatedBody);

    expect(authenticatedResponse.statusCode).toBe(200);
    expect(authenticatedResult.userId.length).toBeGreaterThan(0);
    expect(authenticatedResult.userId).not.toBe('attacker-selected-id');
  }, 60_000);

  it('accepts only the exact Origin or a Referer fallback when Origin is absent', async () => {
    const testServer = createTestServer();
    server = testServer;
    let mutationCount = 0;
    registerProtectedTestRoutes(testServer, () => mutationCount++);
    const email = await registerUser(testServer, registeredEmails);
    const cookies = await getSessionCookie(testServer, email);
    const headers = { cookie: cookies };

    const missingOriginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/test-private/mutations',
      headers,
      payload: {},
    });
    const nullOriginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/test-private/mutations',
      headers: { ...headers, origin: 'null' },
      payload: {},
    });
    const untrustedOriginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/test-private/mutations',
      headers: {
        ...headers,
        origin: 'https://untrusted.example',
        referer: 'https://wallet.test.example/settings',
      },
      payload: {},
    });
    const refererFallbackResponse = await testServer.inject({
      method: 'POST',
      url: '/api/test-private/mutations',
      headers: { ...headers, referer: 'https://wallet.test.example/settings' },
      payload: {},
    });
    const exactOriginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/test-private/mutations',
      headers: { ...headers, origin: 'https://wallet.test.example' },
      payload: {},
    });
    const headReadResponse = await testServer.inject({
      method: 'HEAD',
      url: '/api/test-private/wallets',
      headers,
    });
    const optionsReadResponse = await testServer.inject({
      method: 'OPTIONS',
      url: '/api/test-private/mutations',
      headers: {
        ...headers,
        origin: 'https://wallet.test.example',
        'access-control-request-method': 'POST',
      },
    });

    expect(missingOriginResponse.statusCode).toBe(403);
    expect(nullOriginResponse.statusCode).toBe(403);
    expect(untrustedOriginResponse.statusCode).toBe(403);
    expect(refererFallbackResponse.statusCode).toBe(200);
    expect(exactOriginResponse.statusCode).toBe(200);
    expect(headReadResponse.statusCode).toBe(200);
    expect(optionsReadResponse.statusCode).toBe(204);
    expect(mutationCount).toBe(2);
  });

  it('keeps safe reads outside the origin guard and applies the authenticated-user ceiling after auth', async () => {
    const testServer = createTestServer({ API_AUTHENTICATED_RATE_LIMIT_MAX: '2' });
    server = testServer;
    registerProtectedTestRoutes(testServer);
    const email = await registerUser(testServer, registeredEmails);
    const cookies = await getSessionCookie(testServer, email);
    const requests = [];

    for (let requestCount = 0; requestCount < 3; requestCount += 1) {
      const headers = { cookie: cookies, 'x-user-id': `client-selected-${requestCount}` };

      requests.push(
        await testServer.inject({ method: 'GET', url: '/api/test-private/wallets', headers }),
      );
    }

    expect(requests.map((response) => response.statusCode)).toStrictEqual([200, 200, 429]);
    const limitedBody: unknown = requests[2]?.json();
    expect(apiErrorSchema.parse(limitedBody).error.code).toBe('RATE_LIMITED');
    expect(requests[2]?.headers['retry-after']).toBeDefined();
  });

  it('keeps a lower Fastify request ceiling on the Better Auth catch-all', async () => {
    const testServer = createTestServer({ API_AUTH_RATE_LIMIT_MAX: '1' });
    server = testServer;

    const firstResponse = await testServer.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      remoteAddress: '2001:db8:abcd:12::1',
    });
    const limitedResponse = await testServer.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      remoteAddress: '2001:0db8:abcd:0012::ffff',
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(limitedResponse.statusCode).toBe(429);
    expect(apiErrorSchema.parse(limitedResponse.json()).error.code).toBe('RATE_LIMITED');
    expect(limitedResponse.headers['retry-after']).toBeDefined();
  });

  it('uses Better Auth credential rules and preserves its native 429 response', async () => {
    const testServer = createTestServer({
      BETTER_AUTH_RATE_LIMIT_ENABLED: 'true',
      BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX: '2',
    });
    server = testServer;
    const headers = { origin: 'https://wallet.test.example' };
    const attempts = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      attempts.push(
        await testServer.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          remoteAddress: '192.0.2.80',
          headers,
          payload: { email: 'unknown@example.test', password: 'invalid-password' },
        }),
      );
    }

    const nativeRateLimitBody: unknown = attempts[2]?.json();
    const nativeRateLimitError = zod.object({ message: zod.string() }).parse(nativeRateLimitBody);
    expect(attempts.map((response) => response.statusCode)).toStrictEqual([401, 401, 429]);
    expect(attempts[2]?.headers['x-retry-after']).toBeDefined();
    expect(attempts[2]?.headers['retry-after']).toBeUndefined();
    expect(nativeRateLimitError.message).not.toBe('');
    expect(() => apiErrorSchema.parse(nativeRateLimitBody)).toThrow();
  });

  it('uses trusted proxy IPs consistently for Better Auth limits and ignores untrusted forwarded headers', async () => {
    const untrustedProxyServer = createTestServer({
      BETTER_AUTH_RATE_LIMIT_ENABLED: 'true',
      BETTER_AUTH_RATE_LIMIT_MAX: '1',
    });
    server = untrustedProxyServer;

    const firstUntrustedResponse = await untrustedProxyServer.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      remoteAddress: '192.0.2.81',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    const spoofedUntrustedResponse = await untrustedProxyServer.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      remoteAddress: '192.0.2.81',
      headers: { 'x-forwarded-for': '203.0.113.11' },
    });

    expect(firstUntrustedResponse.statusCode).toBe(200);
    expect(spoofedUntrustedResponse.statusCode).toBe(429);
    await untrustedProxyServer.close();

    const trustedProxyServer = createTestServer({
      API_TRUSTED_PROXY_CIDRS: '127.0.0.1',
      BETTER_AUTH_RATE_LIMIT_ENABLED: 'true',
      BETTER_AUTH_RATE_LIMIT_MAX: '1',
    });
    server = trustedProxyServer;
    await trustedProxyServer.ready();
    await trustedProxyServer.prisma.rateLimit.deleteMany();

    const clientAResponse = await trustedProxyServer.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.12' },
    });
    const clientBResponse = await trustedProxyServer.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.13' },
    });
    const clientARetryResponse = await trustedProxyServer.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.12' },
    });

    expect(clientAResponse.statusCode).toBe(200);
    expect(clientBResponse.statusCode).toBe(200);
    expect(clientARetryResponse.statusCode).toBe(429);
  });

  it('groups IPv6 textual variants within the configured /64 for Better Auth', async () => {
    const testServer = createTestServer({
      BETTER_AUTH_RATE_LIMIT_ENABLED: 'true',
      BETTER_AUTH_RATE_LIMIT_MAX: '1',
    });
    server = testServer;

    const firstAddressResponse = await testServer.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      remoteAddress: '2001:db8:abcd:12::1',
    });
    const sameSubnetResponse = await testServer.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      remoteAddress: '2001:0db8:abcd:0012::ffff',
    });

    expect(firstAddressResponse.statusCode).toBe(200);
    expect(sameSubnetResponse.statusCode).toBe(429);
  });
});

function registerProtectedTestRoutes(
  testServer: TestServer,
  onMutation: () => void = () => undefined,
): void {
  testServer.register(
    (privateRoutes, _options, completePluginRegistration) => {
      registerPrivateRouteHooks(privateRoutes);
      privateRoutes.get('/wallets', (request) => ({
        userId: request.authSession?.user.id,
      }));
      privateRoutes.post('/mutations', () => {
        onMutation();

        return { status: 'updated' };
      });
      completePluginRegistration();
    },
    { prefix: '/api/test-private' },
  );
}

async function registerUser(testServer: TestServer, registeredEmails: string[]): Promise<string> {
  const email = `${randomUUID()}@example.test`;
  registeredEmails.push(email);

  const response = await testServer.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: 'https://wallet.test.example' },
    payload: { name: 'Authorization Test', email, password: 'a-strong-test-password' },
  });

  expect(response.statusCode).toBe(200);

  return email;
}

async function getSessionCookie(testServer: TestServer, email: string): Promise<string> {
  const sessionResponse = await testServer.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: 'https://wallet.test.example' },
    payload: { email, password: 'a-strong-test-password' },
  });

  expect(sessionResponse.statusCode).toBe(200);

  const setCookie = sessionResponse.headers['set-cookie'];
  const cookieHeaders = Array.isArray(setCookie)
    ? setCookie
    : setCookie === undefined
      ? []
      : [setCookie];

  return cookieHeaders.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}
