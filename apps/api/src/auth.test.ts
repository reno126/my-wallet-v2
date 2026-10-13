import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import { z as zod } from 'zod';

import { apiErrorMessages, apiErrorSchema } from '@my-wallets/contracts';

import { apiEnvironmentSchema } from './config/environment.js';
import { buildServer } from './server.js';

describe('Better Auth API integration', () => {
  let server: ReturnType<typeof buildServer> | undefined;
  let email: string | undefined;

  afterEach(async () => {
    if (server?.hasDecorator('prisma')) {
      if (email) {
        await server.prisma.user.deleteMany({ where: { email } });
      }

      await server.close();
    }

    server = undefined;
    email = undefined;
  });

  it('registers, resolves a session, protects a route, signs out, and allows a new login', async () => {
    const testServer = createTestServer();
    server = testServer;
    email = `${randomUUID()}@example.test`;

    testServer.register((routeServer, _pluginOptions, completePluginRegistration) => {
      routeServer.get('/api/test-session', { preHandler: routeServer.authenticate }, (request) => ({
        userId: request.authSession?.user.id,
      }));
      completePluginRegistration();
    });

    const registrationResponse = await testServer.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://127.0.0.1:5173' },
      payload: { name: 'Test User', email, password: 'a-strong-test-password' },
    });
    const registrationCookies = readCookieHeader(registrationResponse.headers['set-cookie']);

    expect(registrationResponse.statusCode).toBe(200);
    expect(registrationCookies).not.toBe('');
    expect(cookieHeaders(registrationResponse.headers['set-cookie']).join(';')).toContain(
      'HttpOnly',
    );
    expect(cookieHeaders(registrationResponse.headers['set-cookie']).join(';')).toContain(
      'SameSite=Lax',
    );
    expect(cookieHeaders(registrationResponse.headers['set-cookie']).join(';')).not.toContain(
      'Domain=',
    );

    const sessionResponse = await testServer.inject({
      method: 'GET',
      url: '/api/auth/get-session?disableCookieCache=true',
      headers: { cookie: registrationCookies },
    });
    const sessionBody: unknown = sessionResponse.json();
    const sessionIdentity = zod
      .object({ user: zod.object({ id: zod.string().min(1), email: zod.email() }) })
      .parse(sessionBody);

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionBody).toMatchObject({ user: { email } });

    const protectedResponse = await testServer.inject({
      method: 'GET',
      url: '/api/test-session',
      headers: { cookie: registrationCookies },
    });

    expect(protectedResponse.statusCode).toBe(200);
    expect(protectedResponse.json()).toStrictEqual({ userId: sessionIdentity.user.id });

    const signOutResponse = await testServer.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie: registrationCookies, origin: 'http://127.0.0.1:5173' },
      payload: {},
    });

    expect(signOutResponse.statusCode).toBe(200);

    const signedOutSessionResponse = await testServer.inject({
      method: 'GET',
      url: '/api/auth/get-session?disableCookieCache=true',
      headers: { cookie: registrationCookies },
    });

    expect(signedOutSessionResponse.statusCode).toBe(200);
    expect(signedOutSessionResponse.json()).toBeNull();

    const loginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'http://127.0.0.1:5173' },
      payload: { email, password: 'a-strong-test-password' },
    });
    const loginCookies = readCookieHeader(loginResponse.headers['set-cookie']);

    expect(loginResponse.statusCode).toBe(200);
    expect(loginCookies).not.toBe('');

    const loggedInSessionResponse = await testServer.inject({
      method: 'GET',
      url: '/api/auth/get-session?disableCookieCache=true',
      headers: { cookie: loginCookies },
    });

    expect(loggedInSessionResponse.statusCode).toBe(200);
    expect(loggedInSessionResponse.json()).toMatchObject({ user: { email } });
  }, 60_000);

  it('marks authentication cookies Secure when HTTPS is enabled at ingress', async () => {
    const testServer = createTestServer(true);
    server = testServer;
    email = `${randomUUID()}@example.test`;

    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://127.0.0.1:5173' },
      payload: { name: 'Test User', email, password: 'a-strong-test-password' },
    });

    expect(response.statusCode).toBe(200);
    expect(cookieHeaders(response.headers['set-cookie']).join(';')).toContain('Secure');
  });

  it('enforces the configured password length for credential registration', async () => {
    const testServer = createTestServer();
    server = testServer;
    email = `${randomUUID()}@example.test`;

    const invalidRegistrationInputs = [
      { name: 'Test User', password: 'short' },
      { name: 'Test User', password: 'a'.repeat(129) },
      { name: 'a'.repeat(101), password: 'a-strong-test-password' },
    ];

    for (const input of invalidRegistrationInputs) {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: 'http://127.0.0.1:5173' },
        payload: { ...input, email },
      });

      const body = apiErrorSchema.parse(response.json());

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe('VALIDATION_FAILED');
    }

    expect(await testServer.prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('uses the browser-visible callback URL for Google OAuth initiation', async () => {
    const testServer = createTestServer(false, true);
    server = testServer;

    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: 'http://127.0.0.1:5173' },
      payload: { provider: 'google', callbackURL: '/wallets' },
    });
    const socialSignIn = zod.object({ url: zod.url() }).parse(response.json());
    const googleAuthorizationURL = new URL(socialSignIn.url);

    expect(response.statusCode).toBe(200);
    expect(googleAuthorizationURL.hostname).toBe('accounts.google.com');
    expect(googleAuthorizationURL.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:5173/api/auth/callback/google',
    );
  });

  it('returns the common 401 response when the typed auth hook finds no session', async () => {
    const testServer = createTestServer();
    server = testServer;

    testServer.register((routeServer, _pluginOptions, completePluginRegistration) => {
      routeServer.get('/api/test-session', { preHandler: routeServer.authenticate }, (request) => ({
        userId: request.authSession?.user.id,
      }));
      completePluginRegistration();
    });

    const response = await testServer.inject({ method: 'GET', url: '/api/test-session' });
    const body = apiErrorSchema.parse(response.json());

    expect(response.statusCode).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toBe(apiErrorMessages.UNAUTHENTICATED);
    expect(body.error.requestId).toEqual(expect.any(String));
  });
});

function createTestServer(httpsEnabled = false, googleEnabled = false) {
  return buildServer({
    environment: apiEnvironmentSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL:
        'postgresql://wallet_local:wallet_local_only@127.0.0.1:5432/wallet_test?schema=public',
      API_HTTPS_ENABLED: httpsEnabled ? 'true' : 'false',
      GOOGLE_CLIENT_ID: googleEnabled ? 'test-google-client-id' : '',
      GOOGLE_CLIENT_SECRET: googleEnabled ? 'test-google-client-secret' : '',
    }),
    logger: false,
  });
}

function readCookieHeader(setCookieHeader: string | string[] | undefined): string {
  const cookies = cookieHeaders(setCookieHeader);

  return cookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

function cookieHeaders(setCookieHeader: string | string[] | undefined): string[] {
  return Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader === undefined
      ? []
      : [setCookieHeader];
}
