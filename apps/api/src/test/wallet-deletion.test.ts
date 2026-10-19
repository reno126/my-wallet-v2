import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiErrorSchema, walletListSchema, walletSummarySchema } from '@my-wallets/contracts';

import { createAuthenticatedUser } from '../../test-support/authenticated-user.js';
import { createTestServer, type TestServer } from '../../test-support/create-test-server.js';
import { createOpenApiValidator } from '../../test-support/openapi-contract.js';

describe('when permanently deleting a wallet', () => {
  let server: TestServer | undefined;
  const registeredEmails: string[] = [];

  afterEach(async () => {
    try {
      if (server?.hasDecorator('prisma') && registeredEmails.length > 0) {
        await server.prisma.user.deleteMany({ where: { email: { in: registeredEmails } } });
      }
    } finally {
      await server?.close();
      server = undefined;
      registeredEmails.length = 0;
    }
  });

  it('should hard-delete only the selected wallet and preserve other wallets and user sessions', async () => {
    // Arrange
    const testServer = createTestServer();
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);
    const owner = await createAuthenticatedUser(testServer, registeredEmails);
    const otherUser = await createAuthenticatedUser(testServer, registeredEmails);
    const wallet = await createWallet(testServer, owner.headers);
    const sibling = await createWallet(testServer, owner.headers);
    const foreignWallet = await createWallet(testServer, otherUser.headers);
    const url = `/api/wallets/${wallet.id}`;

    // Act
    const deleted = await testServer.inject({ method: 'DELETE', url, headers: owner.headers });
    const reread = await testServer.inject({ method: 'GET', url, headers: owner.headers });
    const repeated = await testServer.inject({ method: 'DELETE', url, headers: owner.headers });
    const ownerList = await testServer.inject({
      method: 'GET',
      url: '/api/wallets',
      headers: owner.headers,
    });
    const otherList = await testServer.inject({
      method: 'GET',
      url: '/api/wallets',
      headers: otherUser.headers,
    });

    // Assert
    expect(deleted.statusCode).toBe(204);
    expect(reread.statusCode).toBe(404);
    expect(repeated.statusCode).toBe(404);
    contract.assertResponse('delete', url, deleted);
    contract.assertResponse('get', url, reread);
    contract.assertResponse('delete', url, repeated);
    expect(await testServer.prisma.wallet.findUnique({ where: { id: wallet.id } })).toBeNull();
    for (const [response, expectedWallet] of [
      [ownerList, sibling],
      [otherList, foreignWallet],
    ] as const) {
      expect(response.statusCode).toBe(200);
      contract.assertResponse('get', '/api/wallets', response);
      expect(walletListSchema.parse(response.json())).toMatchObject({
        wallets: [expectedWallet],
        pagination: { totalCount: 1 },
      });
    }
    for (const response of [deleted, reread, repeated, ownerList, otherList]) {
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('should conceal foreign wallets and ignore request-supplied ownership', async () => {
    // Arrange
    const testServer = createTestServer();
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);
    const owner = await createAuthenticatedUser(testServer, registeredEmails);
    const attacker = await createAuthenticatedUser(testServer, registeredEmails);
    const wallet = await createWallet(testServer, owner.headers);
    const persisted = await testServer.prisma.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });

    // Act
    const foreignUrl = `/api/wallets/${wallet.id}?userId=${encodeURIComponent(persisted.userId)}`;
    const foreign = await testServer.inject({
      method: 'DELETE',
      url: foreignUrl,
      headers: { ...attacker.headers, 'x-user-id': persisted.userId },
    });
    const missingUrl = `/api/wallets/${randomUUID()}`;
    const missing = await testServer.inject({
      method: 'DELETE',
      url: missingUrl,
      headers: attacker.headers,
    });

    // Assert
    for (const [url, response] of [
      [foreignUrl, foreign],
      [missingUrl, missing],
    ] as const) {
      expect(response.statusCode).toBe(404);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
      expect(response.headers['cache-control']).toBe('no-store');
      contract.assertResponse('delete', url, response);
    }
    expect(await testServer.prisma.wallet.findUnique({ where: { id: wallet.id } })).toEqual(
      persisted,
    );
  });

  it('should reject unauthenticated requests and mutations without trusted origin evidence', async () => {
    // Arrange
    const testServer = createTestServer();
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);
    const owner = await createAuthenticatedUser(testServer, registeredEmails);
    const wallet = await createWallet(testServer, owner.headers);
    const url = `/api/wallets/${wallet.id}`;

    // Act
    const unauthenticated = await testServer.inject({
      method: 'DELETE',
      url,
      headers: { origin: owner.headers.origin },
    });
    const missingOrigin = await testServer.inject({
      method: 'DELETE',
      url,
      headers: { cookie: owner.headers.cookie },
    });
    const wrongOrigin = await testServer.inject({
      method: 'DELETE',
      url,
      headers: { ...owner.headers, origin: 'https://untrusted.example' },
    });

    // Assert
    expect(unauthenticated.statusCode).toBe(401);
    expect(missingOrigin.statusCode).toBe(403);
    expect(wrongOrigin.statusCode).toBe(403);
    for (const response of [unauthenticated, missingOrigin, wrongOrigin]) {
      contract.assertResponse('delete', url, response);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await testServer.prisma.wallet.findUnique({ where: { id: wallet.id } })).not.toBeNull();
  });

  it('should reject invalid wallet IDs without deleting a wallet', async () => {
    // Arrange
    const testServer = createTestServer();
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);
    const owner = await createAuthenticatedUser(testServer, registeredEmails);
    const wallet = await createWallet(testServer, owner.headers);

    // Act
    const url = '/api/wallets/not-a-uuid';
    const response = await testServer.inject({ method: 'DELETE', url, headers: owner.headers });

    // Assert
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    contract.assertResponse('delete', url, response);
    expect(await testServer.prisma.wallet.findUnique({ where: { id: wallet.id } })).not.toBeNull();
  });

  it('should allow exactly one concurrent deletion to succeed', async () => {
    // Arrange
    const testServer = createTestServer();
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);
    const owner = await createAuthenticatedUser(testServer, registeredEmails);
    const wallet = await createWallet(testServer, owner.headers);
    const url = `/api/wallets/${wallet.id}`;

    // Act
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        testServer.inject({
          method: 'DELETE',
          url,
          headers: owner.headers,
        }),
      ),
    );

    // Assert
    expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 404, 404]);
    for (const response of responses) {
      contract.assertResponse('delete', url, response);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await testServer.prisma.wallet.findUnique({ where: { id: wallet.id } })).toBeNull();
  });

  it('should sanitize deletion failures and leave the wallet intact', async () => {
    // Arrange
    const testServer = createTestServer();
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);
    const owner = await createAuthenticatedUser(testServer, registeredEmails);
    const wallet = await createWallet(testServer, owner.headers);
    const url = `/api/wallets/${wallet.id}`;
    vi.spyOn(testServer.prisma.wallet, 'deleteMany').mockRejectedValueOnce(
      new Error('private deletion details'),
    );

    // Act
    const response = await testServer.inject({ method: 'DELETE', url, headers: owner.headers });

    // Assert
    expect(response.statusCode).toBe(500);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.payload).not.toContain('private deletion details');
    expect(response.headers['cache-control']).toBe('no-store');
    contract.assertResponse('delete', url, response);
    expect(await testServer.prisma.wallet.findUnique({ where: { id: wallet.id } })).not.toBeNull();
  });

  it('should rate-limit deletion without removing the wallet', async () => {
    // Arrange
    const testServer = createTestServer({ API_AUTHENTICATED_RATE_LIMIT_MAX: '1' });
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);
    const owner = await createAuthenticatedUser(testServer, registeredEmails);
    const wallet = await createWallet(testServer, owner.headers);
    const url = `/api/wallets/${wallet.id}`;

    // Act
    const response = await testServer.inject({ method: 'DELETE', url, headers: owner.headers });

    // Assert
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.headers['cache-control']).toBe('no-store');
    contract.assertResponse('delete', url, response);
    expect(await testServer.prisma.wallet.findUnique({ where: { id: wallet.id } })).not.toBeNull();
  });
});

async function createWallet(testServer: TestServer, headers: { cookie: string; origin: string }) {
  const response = await testServer.inject({
    method: 'POST',
    url: '/api/wallets',
    headers,
    payload: {
      name: 'Deletion fixture',
      description: 'Preserve unless selected',
      reportingCurrency: 'USD',
    },
  });
  expect(response.statusCode).toBe(201);

  return walletSummarySchema.parse(response.json());
}
