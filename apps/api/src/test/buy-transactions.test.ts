import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorSchema,
  buyTransactionResultSchema,
  createBuyTransactionSchema,
} from '@my-wallets/contracts';

import { createAuthenticatedUser } from '../../test-support/authenticated-user.js';
import { createBuyLedgerFixture } from '../../test-support/buy-ledger.js';
import { createBuyTransactionRepository } from '../repositories/buy-transactions.js';

describe('when recording immutable stock purchases', () => {
  it('should persist exact values and the selected date, returning scoped holdings from the ledger', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const quantity = '9007199254740993.12345678';
    const unitPrice = '9999999999999999999999.99999999';
    // Act
    const first = await fixture.buy({
      symbol: fixture.symbol.toLowerCase(),
      quantity,
      unitPrice,
      description: 'Sunday purchase',
    });
    const second = await fixture.buy({ quantity: '0.00000001' });
    // Assert
    expect(first.statusCode).toBe(201);
    const result = buyTransactionResultSchema.parse(first.json());
    expect(result.transaction).toMatchObject({
      walletId: fixture.wallet.id,
      symbol: fixture.symbol,
      side: 'BUY',
      quantity,
      unitPrice,
      currency: 'USD',
      transactionDate: '2026-10-18',
      description: 'Sunday purchase',
    });
    expect(result.holding).toStrictEqual({
      walletId: fixture.wallet.id,
      symbol: fixture.symbol,
      quantity,
      quoteCurrency: 'USD',
    });
    const persisted = await fixture.server.prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: result.transaction.id },
    });
    expect(persisted.quantity.toFixed()).toBe(quantity);
    expect(persisted.unitPrice.toFixed()).toBe(unitPrice);
    expect(persisted.createdAt.toISOString()).toBe(result.transaction.createdAt);
    expect(persisted.transactionDate.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(buyTransactionResultSchema.parse(second.json()).holding.quantity).toBe(
      '9007199254740993.12345679',
    );
    expect(fixture.used()).toBe(2);
    expect(fixture.requests.map((request) => request.pathname)).toStrictEqual([
      '/stable/profile',
      '/stable/profile',
    ]);
    expect(fixture.reservationsAtDispatch).toStrictEqual([1, 2]);
    expect(
      await fixture.server.prisma.instrument.findUnique({ where: { symbol: fixture.symbol } }),
    ).toMatchObject({ quoteCurrency: 'USD', name: 'Verified stock' });
  });

  it('should serialize simultaneous purchases and preserve totals beyond the single-input range', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const quantity = '9999999999999999999999.99999999';
    // Act
    const responses = await Promise.all([fixture.buy({ quantity }), fixture.buy({ quantity })]);
    // Assert
    expect(responses.map((response) => response.statusCode)).toStrictEqual([201, 201]);
    expect(
      responses
        .map((response) => buyTransactionResultSchema.parse(response.json()).holding.quantity)
        .sort(),
    ).toStrictEqual(['19999999999999999999999.99999998', quantity].sort());
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id },
      }),
    ).toBe(2);
  });

  it('should share instrument records across users while keeping wallet holdings and deletion private', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const otherUser = await createAuthenticatedUser(fixture.server, fixture.registeredEmails);
    const sibling = await fixture.createWallet(fixture.headers);
    const foreign = await fixture.createWallet(otherUser.headers);
    // Act
    const responses = await Promise.all([
      fixture.buy({ quantity: '0.1' }),
      fixture.buy({ quantity: '0.2' }, { url: `/api/wallets/${sibling.id}/transactions` }),
      fixture.buy(
        { quantity: '0.3' },
        { url: `/api/wallets/${foreign.id}/transactions`, headers: otherUser.headers },
      ),
    ]);
    const deleted = await fixture.server.inject({
      method: 'DELETE',
      url: `/api/wallets/${fixture.wallet.id}`,
      headers: fixture.headers,
    });
    // Assert
    expect(responses.map((response) => response.statusCode)).toStrictEqual([201, 201, 201]);
    expect(
      responses.map(
        (response) => buyTransactionResultSchema.parse(response.json()).holding.quantity,
      ),
    ).toStrictEqual(['0.1', '0.2', '0.3']);
    fixture.contract.assertResponse('delete', `/api/wallets/${fixture.wallet.id}`, deleted);
    expect(deleted.statusCode).toBe(204);
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id },
      }),
    ).toBe(0);
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: { in: [sibling.id, foreign.id] } },
      }),
    ).toBe(2);
    expect(
      await fixture.server.prisma.instrument.count({ where: { symbol: fixture.symbol } }),
    ).toBe(1);
    const remaining = await fixture.buy(
      {},
      { url: `/api/wallets/${foreign.id}/transactions`, headers: otherUser.headers },
    );
    expect(buyTransactionResultSchema.parse(remaining.json()).holding.quantity).toBe('0.4');
    for (const [walletId, headers] of [
      [sibling.id, fixture.headers],
      [foreign.id, otherUser.headers],
    ] as const) {
      const response = await fixture.server.inject({
        method: 'DELETE',
        url: `/api/wallets/${walletId}`,
        headers,
      });
      fixture.contract.assertResponse('delete', `/api/wallets/${walletId}`, response);
      expect(response.statusCode).toBe(204);
    }
    expect(
      await fixture.server.prisma.instrument.count({ where: { symbol: fixture.symbol } }),
    ).toBe(1);
    expect(
      await fixture.server.prisma.ledgerTransaction.count({ where: { symbol: fixture.symbol } }),
    ).toBe(0);
  });

  it('should recheck wallet ownership after a concurrent deletion during provider verification', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    let finishVerification = () => {};
    let resumeVerification = () => {};
    const verificationFinished = new Promise<void>((resolve) => {
      finishVerification = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      resumeVerification = resolve;
    });
    const verify = fixture.server.instrumentVerifier.verify.bind(fixture.server.instrumentVerifier);
    vi.spyOn(fixture.server.instrumentVerifier, 'verify').mockImplementationOnce(async (symbol) => {
      const result = await verify(symbol);
      finishVerification();
      await resumed;
      return result;
    });
    // Act
    const pendingBuy = fixture.buy();
    let deletionStatus: number;
    try {
      await verificationFinished;
      const deletion = await fixture.server.inject({
        method: 'DELETE',
        url: `/api/wallets/${fixture.wallet.id}`,
        headers: fixture.headers,
      });
      fixture.contract.assertResponse('delete', `/api/wallets/${fixture.wallet.id}`, deletion);
      deletionStatus = deletion.statusCode;
    } finally {
      resumeVerification();
    }
    const response = await pendingBuy;
    // Assert
    expect(deletionStatus).toBe(204);
    expect(response.statusCode).toBe(404);
    expect(fixture.used()).toBe(1);
    expect(
      await fixture.server.prisma.instrument.findUnique({ where: { symbol: fixture.symbol } }),
    ).toBeNull();
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id },
      }),
    ).toBe(0);
  });

  it('should enforce database immutability and preserve referenced shared instruments', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const response = await fixture.buy();
    const result = buyTransactionResultSchema.parse(response.json());
    const where = { id: result.transaction.id };
    const original = await fixture.server.prisma.ledgerTransaction.findUniqueOrThrow({ where });
    // Act
    const update = fixture.server.prisma.ledgerTransaction.update({
      where,
      data: { quantity: '5' },
    });
    // Assert
    await expect(update).rejects.toThrow();
    await expect(
      fixture.server.prisma.instrument.delete({ where: { symbol: fixture.symbol } }),
    ).rejects.toThrow();
    expect(await fixture.server.prisma.ledgerTransaction.findUnique({ where })).toEqual(original);
    const unsupportedPath = `/wallets/{walletId}/transactions/{transactionId}`;
    expect(fixture.contract.document.paths).not.toHaveProperty(unsupportedPath);
  });

  it.each([{ quantity: '0' }, { unitPrice: '-1' }, { description: 'a'.repeat(501) }])(
    'should roll back the entire database write when a constraint fails: %j',
    async (changes) => {
      // Arrange
      const fixture = await createBuyLedgerFixture();
      const wallet = await fixture.server.prisma.wallet.findUniqueOrThrow({
        where: { id: fixture.wallet.id },
      });
      const repository = createBuyTransactionRepository(fixture.server.prisma);
      const input = { ...createBuyTransactionSchema.parse(fixture.input), ...changes };
      // Act
      const operation = repository.createForUser(wallet.userId, wallet.id, input, {
        symbol: fixture.symbol,
        name: 'Verified stock',
        exchange: 'NASDAQ',
        quoteCurrency: 'USD',
      });
      // Assert
      await expect(operation).rejects.toThrow();
      expect(
        await fixture.server.prisma.instrument.findUnique({ where: { symbol: fixture.symbol } }),
      ).toBeNull();
      expect(
        await fixture.server.prisma.ledgerTransaction.count({ where: { walletId: wallet.id } }),
      ).toBe(0);
    },
  );

  it.each([
    [{ currency: 'EUR' }, 422, 'UNSUPPORTED_CURRENCY'],
    [{ currency: null }, 422, 'CURRENCY_UNAVAILABLE'],
    [{ isEtf: true }, 422, 'UNSUPPORTED_INSTRUMENT'],
    [{ isFund: true }, 422, 'UNSUPPORTED_INSTRUMENT'],
    [{ isEtf: null }, 422, 'UNSUPPORTED_INSTRUMENT'],
    [{ isFund: null }, 422, 'UNSUPPORTED_INSTRUMENT'],
    [{ exchange: 'CRYPTO' }, 422, 'UNSUPPORTED_INSTRUMENT'],
    [{ exchange: null }, 422, 'UNSUPPORTED_INSTRUMENT'],
    [{ symbol: 'OTHER' }, 502, 'PROVIDER_ERROR'],
  ] as const)(
    'should reject unverified provider metadata without persistence: %j',
    async (changes, status, code) => {
      // Arrange
      const fixture = await createBuyLedgerFixture(changes);
      // Act
      const response = await fixture.buy();
      // Assert
      expect(response.statusCode).toBe(status);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe(code);
      expect(fixture.used()).toBe(1);
      expect(
        await fixture.server.prisma.ledgerTransaction.count({
          where: { walletId: fixture.wallet.id },
        }),
      ).toBe(0);
      expect(
        await fixture.server.prisma.instrument.findUnique({ where: { symbol: fixture.symbol } }),
      ).toBeNull();
    },
  );

  it('should conceal foreign and missing wallets before spending provider quota', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const attacker = await createAuthenticatedUser(fixture.server, fixture.registeredEmails);
    // Act
    const foreign = await fixture.buy({}, { headers: attacker.headers });
    const missing = await fixture.buy({}, { url: `/api/wallets/${randomUUID()}/transactions` });
    // Assert
    for (const response of [foreign, missing]) {
      expect(response.statusCode).toBe(404);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    }
    expect(fixture.used()).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should reject invalid inputs and untrusted mutations without provider dispatch', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    // Act
    const invalid = await fixture.buy({ quantity: '0.123456789' });
    const numeric = await fixture.buy({ unitPrice: 190.1 });
    const future = await fixture.buy({ transactionDate: '2999-01-01' });
    const sell = await fixture.buy({ side: 'SELL' });
    const currency = await fixture.buy({ currency: 'EUR' });
    const spoofed = await fixture.buy({ userId: 'attacker', quoteCurrency: 'USD' });
    const invalidWallet = await fixture.buy({}, { url: '/api/wallets/invalid/transactions' });
    const unauthenticated = await fixture.buy({}, { headers: { origin: fixture.headers.origin } });
    const missingOrigin = await fixture.buy(
      {},
      { headers: { cookie: 'cookie' in fixture.headers ? fixture.headers.cookie : '' } },
    );
    // Assert
    for (const response of [invalid, numeric, future, sell, currency, spoofed, invalidWallet]) {
      expect(response.statusCode).toBe(400);
    }
    expect(unauthenticated.statusCode).toBe(401);
    expect(missingOrigin.statusCode).toBe(403);
    expect(fixture.used()).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should sanitize parser errors without spending provider quota', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const requests = [
      {
        headers: { ...fixture.headers, 'content-type': 'application/json' },
        payload: '{',
        status: 400,
      },
      {
        headers: { ...fixture.headers, 'content-type': 'application/xml' },
        payload: '<trade/>',
        status: 415,
      },
      {
        headers: { ...fixture.headers, 'content-type': 'application/json' },
        payload: JSON.stringify({ description: 'a'.repeat(1_048_577) }),
        status: 413,
      },
    ];
    // Act
    const responses = [];
    for (const request of requests) {
      const response = await fixture.server.inject({
        method: 'POST',
        url: fixture.url,
        headers: request.headers,
        payload: request.payload,
      });
      responses.push({ response, status: request.status });
    }
    // Assert
    for (const { response, status } of responses) {
      fixture.contract.assertResponse('post', fixture.url, response);
      expect(response.statusCode).toBe(status);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(fixture.used()).toBe(0);
  });

  it('should apply the private request ceiling before provider dispatch', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture(
      {},
      { environment: { API_AUTHENTICATED_RATE_LIMIT_MAX: '1' } },
    );
    // Act
    const response = await fixture.buy();
    // Assert
    expect(response.statusCode).toBe(429);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
    expect(fixture.used()).toBe(0);
  });

  it.each([
    [{ replies: [{ status: 500 }] }, 502, 'PROVIDER_ERROR', 1],
    [{ replies: [{ stall: true }] }, 504, 'PROVIDER_TIMEOUT', 1],
    [{ replies: [{ body: [] }] }, 404, 'NOT_FOUND', 1],
    [{ quotaLimit: 0 }, 503, 'PROVIDER_QUOTA_EXHAUSTED', 0],
    [{ configureQuota: false }, 503, 'PROVIDER_UNAVAILABLE', 0],
  ] as const)(
    'should leave no partial writes after provider failure: %j',
    async (options, status, code, used) => {
      // Arrange
      const fixture = await createBuyLedgerFixture({}, options);
      // Act
      const response = await fixture.buy();
      // Assert
      expect(response.statusCode).toBe(status);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe(code);
      expect(fixture.used()).toBe(used);
      expect(
        await fixture.server.prisma.ledgerTransaction.count({
          where: { walletId: fixture.wallet.id },
        }),
      ).toBe(0);
      expect(
        await fixture.server.prisma.instrument.findUnique({ where: { symbol: fixture.symbol } }),
      ).toBeNull();
    },
  );

  it('should sanitize unexpected database failures', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const failingRepository = vi
      .spyOn(fixture.server.prisma, '$transaction')
      .mockRejectedValueOnce(new Error('database-unavailable-private-detail'));
    // Act
    const response = await fixture.buy();
    // Assert
    expect(response.statusCode).toBe(500);
    expect(response.payload).not.toContain('database-unavailable-private-detail');
    expect(
      await fixture.server.prisma.instrument.findUnique({ where: { symbol: fixture.symbol } }),
    ).toBeNull();
    failingRepository.mockRestore();
  });
});
