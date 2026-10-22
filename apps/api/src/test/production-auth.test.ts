import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';
import { z as zod } from 'zod';

import { createTestServer } from '../../test-support/create-test-server.js';

it('uses the public HTTPS origin for secure sessions, mutations and Google callbacks', async () => {
  const origin = 'https://wallet.preview.example';
  const remoteAddress = '198.18.8.42';
  const email = `production-preview-${randomUUID()}@example.test`;
  let oauthState: string | null = null;
  const server = createTestServer({
    NODE_ENV: 'production',
    API_HTTPS_ENABLED: 'true',
    BETTER_AUTH_URL: origin,
    WEB_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'preview-test-only-google-client',
    GOOGLE_CLIENT_SECRET: 'preview-test-only-google-secret',
  });
  try {
    const registration = await server.inject({
      remoteAddress,
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin },
      payload: { name: 'Preview Investor', email, password: 'strong-preview-test-password' },
    });
    expect(registration.statusCode).toBe(200);
    expect(registration.headers['strict-transport-security']).toBe('max-age=15552000');
    const rawCookies = registration.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/;\s*Secure(?:;|$)/i);
      expect(cookie).toMatch(/;\s*HttpOnly(?:;|$)/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax(?:;|$)/i);
      expect(cookie).not.toMatch(/;\s*Domain=/i);
    }
    const cookie = cookies.map((value) => value.split(';', 1)[0]).join('; ');
    const session = await server.inject({
      remoteAddress,
      method: 'GET',
      url: '/api/auth/get-session?disableCookieCache=true',
      headers: { cookie },
    });
    expect(session.json()).toMatchObject({ user: { email } });
    for (const mutationOrigin of ['https://untrusted.example', origin]) {
      const mutation = await server.inject({
        remoteAddress,
        method: 'POST',
        url: '/api/wallets',
        headers: { cookie, origin: mutationOrigin },
        payload: { name: 'Preview wallet', reportingCurrency: 'USD' },
      });
      expect(mutation.statusCode).toBe(mutationOrigin === origin ? 201 : 403);
    }
    const social = await server.inject({
      remoteAddress,
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin },
      payload: { provider: 'google', callbackURL: '/wallets' },
    });
    expect(social.statusCode).toBe(200);
    const { url } = zod.object({ url: zod.url() }).parse(social.json());
    const authorizationUrl = new URL(url);
    oauthState = authorizationUrl.searchParams.get('state');
    expect(oauthState).toBeTruthy();
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      `${origin}/api/auth/callback/google`,
    );
    const signOut = await server.inject({
      remoteAddress,
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin },
      payload: {},
    });
    expect(signOut.statusCode).toBe(200);
    const expiredSession = await server.inject({
      remoteAddress,
      method: 'GET',
      url: '/api/auth/get-session?disableCookieCache=true',
      headers: { cookie },
    });
    expect(expiredSession.json()).toBeNull();
  } finally {
    try {
      if (server.hasDecorator('prisma')) {
        await server.prisma.user.deleteMany({ where: { email } });
        await server.prisma.rateLimit.deleteMany({ where: { key: { contains: remoteAddress } } });
        if (oauthState) {
          await server.prisma.verification.deleteMany({
            where: { identifier: { endsWith: oauthState } },
          });
        }
      }
    } finally {
      await server.close();
    }
  }
});
