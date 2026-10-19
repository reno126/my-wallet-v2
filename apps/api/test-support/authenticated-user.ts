import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type { TestServer } from './create-test-server.js';

export async function createAuthenticatedUser(testServer: TestServer, registeredEmails: string[]) {
  const email = `${randomUUID()}@example.test`;
  registeredEmails.push(email);
  const headers = { origin: 'https://wallet.test.example' };

  const registrationResponse = await testServer.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers,
    payload: { name: 'Wallet API Test', email, password: 'a-strong-test-password' },
  });
  expect(registrationResponse.statusCode).toBe(200);

  const signInResponse = await testServer.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers,
    payload: { email, password: 'a-strong-test-password' },
  });
  expect(signInResponse.statusCode).toBe(200);

  const setCookie = signInResponse.headers['set-cookie'];
  const cookieHeaders = Array.isArray(setCookie)
    ? setCookie
    : setCookie === undefined
      ? []
      : [setCookie];

  return {
    headers: {
      ...headers,
      cookie: cookieHeaders.map((cookie) => cookie.split(';', 1)[0]).join('; '),
    },
  };
}
