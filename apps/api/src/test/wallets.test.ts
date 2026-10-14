import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { apiErrorSchema, walletListSchema, walletSummarySchema } from '@my-wallets/contracts';

import { createTestServer, type TestServer } from '../../test-support/create-test-server.js';
import { createOpenApiValidator } from '../../test-support/openapi-contract.js';

describe('wallet API', () => {
  let server: TestServer | undefined;
  const registeredEmails: string[] = [];

  afterEach(async () => {
    const testServer = server;
    const testEmails = [...registeredEmails];
    server = undefined;
    registeredEmails.length = 0;

    try {
      if (testServer?.hasDecorator('prisma')) {
        if (testEmails.length > 0) {
          await testServer.prisma.user.deleteMany({ where: { email: { in: testEmails } } });
        }
      }
    } finally {
      await testServer?.close();
    }
  });

  it('creates, lists, reads, and updates only lifecycle wallet fields', async () => {
    const testServer = createTestServer();
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);
    const owner = await createAuthenticatedUser(testServer, registeredEmails);
    const otherUser = await createAuthenticatedUser(testServer, registeredEmails);

    const createFirstResponse = await testServer.inject({
      method: 'POST',
      url: '/api/wallets',
      headers: owner.headers,
      payload: {
        name: '  Long-term  ',
        description: '  Retirement investments  ',
        reportingCurrency: 'USD',
      },
    });
    contract.assertResponse('post', '/api/wallets', createFirstResponse);
    expect(createFirstResponse.statusCode).toBe(201);
    const firstWallet = walletSummarySchema.parse(createFirstResponse.json());
    expect(firstWallet).toMatchObject({
      name: 'Long-term',
      description: 'Retirement investments',
      reportingCurrency: 'USD',
    });
    expect(firstWallet.id).toEqual(expect.any(String));

    const createSecondResponse = await testServer.inject({
      method: 'POST',
      url: '/api/wallets',
      headers: owner.headers,
      payload: { name: 'Short-term', reportingCurrency: 'USD' },
    });
    contract.assertResponse('post', '/api/wallets', createSecondResponse);
    expect(createSecondResponse.statusCode).toBe(201);

    const createOtherResponse = await testServer.inject({
      method: 'POST',
      url: '/api/wallets',
      headers: otherUser.headers,
      payload: { name: 'Other user wallet', reportingCurrency: 'USD' },
    });
    contract.assertResponse('post', '/api/wallets', createOtherResponse);
    expect(createOtherResponse.statusCode).toBe(201);

    const firstPageResponse = await testServer.inject({
      method: 'GET',
      url: '/api/wallets?page=1&pageSize=1',
      headers: owner.headers,
    });
    contract.assertResponse('get', '/api/wallets', firstPageResponse);
    expect(firstPageResponse.statusCode).toBe(200);
    expect(walletListSchema.parse(firstPageResponse.json())).toMatchObject({
      wallets: [{ name: 'Short-term', reportingCurrency: 'USD' }],
      pagination: { page: 1, pageSize: 1, totalCount: 2, totalPages: 2 },
    });

    const secondPageResponse = await testServer.inject({
      method: 'GET',
      url: '/api/wallets?page=2&pageSize=1',
      headers: owner.headers,
    });
    contract.assertResponse('get', '/api/wallets', secondPageResponse);
    expect(walletListSchema.parse(secondPageResponse.json()).wallets).toMatchObject([
      { id: firstWallet.id, name: 'Long-term' },
    ]);

    const readResponse = await testServer.inject({
      method: 'GET',
      url: `/api/wallets/${firstWallet.id}`,
      headers: owner.headers,
    });
    contract.assertResponse('get', `/api/wallets/${firstWallet.id}`, readResponse);
    expect(walletSummarySchema.parse(readResponse.json())).toMatchObject({
      id: firstWallet.id,
      name: 'Long-term',
    });

    const updateResponse = await testServer.inject({
      method: 'PATCH',
      url: `/api/wallets/${firstWallet.id}`,
      headers: owner.headers,
      payload: { name: 'Core portfolio', description: '' },
    });
    contract.assertResponse('patch', `/api/wallets/${firstWallet.id}`, updateResponse);
    expect(walletSummarySchema.parse(updateResponse.json())).toMatchObject({
      id: firstWallet.id,
      name: 'Core portfolio',
      reportingCurrency: 'USD',
    });
    expect(walletSummarySchema.parse(updateResponse.json()).description).toBeUndefined();

    const otherUsersList = await testServer.inject({
      method: 'GET',
      url: '/api/wallets',
      headers: otherUser.headers,
    });
    contract.assertResponse('get', '/api/wallets', otherUsersList);
    expect(walletListSchema.parse(otherUsersList.json()).wallets).toMatchObject([
      { name: 'Other user wallet' },
    ]);
  }, 60_000);

  it('rejects invalid input and hides wallets owned by another user', async () => {
    const testServer = createTestServer();
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);
    const owner = await createAuthenticatedUser(testServer, registeredEmails);
    const otherUser = await createAuthenticatedUser(testServer, registeredEmails);

    const createResponse = await testServer.inject({
      method: 'POST',
      url: '/api/wallets',
      headers: owner.headers,
      payload: { name: 'Private wallet', reportingCurrency: 'USD' },
    });
    expect(createResponse.statusCode).toBe(201);
    const wallet = walletSummarySchema.parse(createResponse.json());

    const blankNameResponse = await testServer.inject({
      method: 'POST',
      url: '/api/wallets',
      headers: owner.headers,
      payload: { name: '   ', reportingCurrency: 'USD' },
    });
    contract.assertResponse('post', '/api/wallets', blankNameResponse);
    expect(blankNameResponse.statusCode).toBe(400);
    expect(apiErrorSchema.parse(blankNameResponse.json()).error.code).toBe('VALIDATION_FAILED');

    const unsupportedCurrencyResponse = await testServer.inject({
      method: 'POST',
      url: '/api/wallets',
      headers: owner.headers,
      payload: { name: 'Foreign currency wallet', reportingCurrency: 'EUR' },
    });
    contract.assertResponse('post', '/api/wallets', unsupportedCurrencyResponse);
    expect(unsupportedCurrencyResponse.statusCode).toBe(400);

    const emptyUpdateResponse = await testServer.inject({
      method: 'PATCH',
      url: `/api/wallets/${wallet.id}`,
      headers: owner.headers,
      payload: {},
    });
    contract.assertResponse('patch', `/api/wallets/${wallet.id}`, emptyUpdateResponse);
    expect(emptyUpdateResponse.statusCode).toBe(400);

    const oversizedPageResponse = await testServer.inject({
      method: 'GET',
      url: '/api/wallets?pageSize=101',
      headers: owner.headers,
    });
    contract.assertResponse('get', '/api/wallets', oversizedPageResponse);
    expect(oversizedPageResponse.statusCode).toBe(400);

    const otherUserRead = await testServer.inject({
      method: 'GET',
      url: `/api/wallets/${wallet.id}`,
      headers: otherUser.headers,
    });
    contract.assertResponse('get', `/api/wallets/${wallet.id}`, otherUserRead);
    expect(otherUserRead.statusCode).toBe(404);
    expect(apiErrorSchema.parse(otherUserRead.json()).error.code).toBe('NOT_FOUND');

    const otherUserUpdate = await testServer.inject({
      method: 'PATCH',
      url: `/api/wallets/${wallet.id}`,
      headers: otherUser.headers,
      payload: { name: 'Stolen wallet' },
    });
    contract.assertResponse('patch', `/api/wallets/${wallet.id}`, otherUserUpdate);
    expect(otherUserUpdate.statusCode).toBe(404);

    const ownerRead = await testServer.inject({
      method: 'GET',
      url: `/api/wallets/${wallet.id}`,
      headers: owner.headers,
    });
    expect(walletSummarySchema.parse(ownerRead.json()).name).toBe('Private wallet');
  }, 60_000);
});

async function createAuthenticatedUser(testServer: TestServer, registeredEmails: string[]) {
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
