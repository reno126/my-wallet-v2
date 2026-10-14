import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import { z as zod } from 'zod';

import { apiErrorSchema } from '@my-wallets/contracts';

import { createTestServer, type TestServer } from '../../test-support/create-test-server.js';

describe('Better Auth API integration', () => {
  let server: TestServer | undefined;
  let email: string | undefined;

  afterEach(async () => {
    const testServer = server;
    const testEmail = email;
    server = undefined;
    email = undefined;

    try {
      if (testServer?.hasDecorator('prisma') && testEmail) {
        await testServer.prisma.user.deleteMany({ where: { email: testEmail } });
      }
    } finally {
      await testServer?.close();
    }
  });

  it('registers, resolves a session, protects a route, signs out, and allows a new login', async () => {
    const testServer = createAuthTestServer();
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
      headers: { origin: 'http://localhost:5173' },
      payload: { name: 'Test User', email, password: 'a-strong-test-password' },
    });
    const registrationCookies = readCookieHeader(registrationResponse.headers['set-cookie']);

    expect(registrationResponse.statusCode).toBe(200);
    expect(registrationCookies).not.toBe('');
    expectAuthCookieAttributes(registrationResponse.headers['set-cookie']);

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
      headers: { cookie: registrationCookies, origin: 'http://localhost:5173' },
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
      headers: { origin: 'http://localhost:5173' },
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
    const testServer = createAuthTestServer({ httpsEnabled: true });
    server = testServer;
    email = `${randomUUID()}@example.test`;

    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:5173' },
      payload: { name: 'Test User', email, password: 'a-strong-test-password' },
    });

    expect(response.statusCode).toBe(200);
    expectAuthCookieAttributes(response.headers['set-cookie'], { secure: true });
  });

  it('enforces the configured password length for credential registration', async () => {
    const testServer = createAuthTestServer();
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
        headers: { origin: 'http://localhost:5173' },
        payload: { ...input, email },
      });

      const body = apiErrorSchema.parse(response.json());

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe('VALIDATION_FAILED');
    }

    expect(await testServer.prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('uses the browser-visible callback URL for Google OAuth initiation', async () => {
    const testServer = createAuthTestServer({ googleEnabled: true });
    server = testServer;

    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: 'http://localhost:5173' },
      payload: { provider: 'google', callbackURL: '/wallets' },
    });
    const socialSignIn = zod.object({ url: zod.url() }).parse(response.json());
    const googleAuthorizationURL = new URL(socialSignIn.url);

    expect(response.statusCode).toBe(200);
    expect(googleAuthorizationURL.hostname).toBe('accounts.google.com');
    expect(googleAuthorizationURL.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/api/auth/callback/google',
    );
  });
});

interface AuthTestServerOptions {
  httpsEnabled?: boolean;
  googleEnabled?: boolean;
}

function createAuthTestServer({
  httpsEnabled = false,
  googleEnabled = false,
}: AuthTestServerOptions = {}) {
  return createTestServer({
    BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    WEB_ORIGIN: 'http://localhost:5173',
    API_HTTPS_ENABLED: httpsEnabled ? 'true' : 'false',
    GOOGLE_CLIENT_ID: googleEnabled ? 'test-google-client-id' : '',
    GOOGLE_CLIENT_SECRET: googleEnabled ? 'test-google-client-secret' : '',
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

function expectAuthCookieAttributes(
  setCookieHeader: string | string[] | undefined,
  { secure = false }: { secure?: boolean } = {},
): void {
  const headers = cookieHeaders(setCookieHeader);

  expect(headers.length).toBeGreaterThan(0);
  for (const header of headers) {
    expect(header).toMatch(/;\s*httponly(?:;|$)/i);
    expect(header).toMatch(/;\s*samesite=lax(?:;|$)/i);
    expect(header).not.toMatch(/;\s*domain=/i);
    if (secure) {
      expect(header).toMatch(/;\s*secure(?:;|$)/i);
    }
  }
}
