import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorSchema,
  buyTransactionResultSchema,
  transactionResultSchema,
} from '@my-wallets/contracts';

import { createAuthenticatedUser } from '../../test-support/authenticated-user.js';
import { createBuyLedgerFixture } from '../../test-support/buy-ledger.js';
import { calculatePosition } from '../domain/accounting/position.ts';

describe('when recording immutable stock sales', () => {
  it('should persist an exact fractional sale and replay its FIFO cost without provider dispatch', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({
      quantity: '1.23456789',
      unitPrice: '10.00000001',
      transactionDate: '2026-10-16',
    });
    await fixture.buy({
      quantity: '0.76543211',
      unitPrice: '20.00000002',
      transactionDate: '2026-10-17',
    });
    // Act
    const response = await fixture.sell({
      symbol: fixture.symbol.toLowerCase(),
      quantity: '1.5',
      unitPrice: '30.00000003',
      description: 'Partial sale',
    });
    const rows = await fixture.server.prisma.ledgerTransaction.findMany({
      where: { walletId: fixture.wallet.id },
    });
    const accounting = calculatePosition(
      { walletId: fixture.wallet.id, symbol: fixture.symbol, currency: 'USD' },
      rows.map((row) => ({
        ...row,
        transactionDate: row.transactionDate.toISOString().slice(0, 10),
        quantity: row.quantity.toFixed(),
        unitPrice: row.unitPrice.toFixed(),
      })),
    );
    // Assert
    expect(response.statusCode).toBe(201);
    const result = transactionResultSchema.parse(response.json());
    expect(result.transaction).toMatchObject({
      side: 'SELL',
      quantity: '1.5',
      unitPrice: '30.00000003',
      currency: 'USD',
      transactionDate: fixture.input.transactionDate,
      description: 'Partial sale',
    });
    expect(result.holding).toMatchObject({ quantity: '0.5', quoteCurrency: 'USD' });
    expect(rows.find((row) => row.id === result.transaction.id)?.unitPrice.toFixed()).toBe(
      '30.00000003',
    );
    expect(accounting).toMatchObject({
      ok: true,
      value: {
        remainingCostBasis: '10.00000001',
        averageUnitCost: '20.00000002',
        realizedProfitLoss: '27.3456789273456789',
        sales: [{ proceeds: '45.000000045', costBasis: '17.6543211176543211' }],
      },
    });
    expect(fixture.used()).toBe(2);
    expect(fixture.requests).toHaveLength(2);
  });

  it('should return zero after a full close and net holdings after a later purchase', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({ quantity: '9007199254740993.12345678', transactionDate: '2026-10-16' });
    // Act
    const sale = await fixture.sell({
      quantity: '9007199254740993.12345678',
      unitPrice: '9999999999999999999999.99999999',
      transactionDate: '2026-10-17',
    });
    const reopened = await fixture.buy({ quantity: '0.00000001' });
    // Assert
    expect(sale.statusCode).toBe(201);
    expect(transactionResultSchema.parse(sale.json()).holding.quantity).toBe('0');
    expect(buyTransactionResultSchema.parse(reopened.json()).holding.quantity).toBe('0.00000001');
    expect(fixture.used()).toBe(2);
  });

  it('should reject a historical oversell even when present inventory could cover it', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({ quantity: '1', transactionDate: '2026-10-17' });
    // Act
    const response = await fixture.sell({ quantity: '0.5', transactionDate: '2026-10-16' });
    // Assert
    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('INSUFFICIENT_HOLDING');
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id },
      }),
    ).toBe(1);
    expect(fixture.used()).toBe(1);
  });

  it('should roll back a backdated sale that would make a later sale oversell', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({ quantity: '1', transactionDate: '2026-10-15' });
    await fixture.buy({ quantity: '1', transactionDate: '2026-10-18' });
    const firstSale = await fixture.sell({ quantity: '1', transactionDate: '2026-10-17' });
    const before = await fixture.server.prisma.ledgerTransaction.findMany({
      where: { walletId: fixture.wallet.id },
      orderBy: { id: 'asc' },
    });
    // Act
    const response = await fixture.sell({ quantity: '0.00000001', transactionDate: '2026-10-16' });
    // Assert
    expect(firstSale.statusCode).toBe(201);
    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('INSUFFICIENT_HOLDING');
    expect(
      await fixture.server.prisma.ledgerTransaction.findMany({
        where: { walletId: fixture.wallet.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it('should accept a backdated sale when every chronological inventory balance remains valid', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({ quantity: '3', transactionDate: '2026-10-15' });
    await fixture.buy({ quantity: '2', transactionDate: '2026-10-18' });
    const laterSale = await fixture.sell({ quantity: '1', transactionDate: '2026-10-17' });
    // Act
    const backdatedSale = await fixture.sell({ quantity: '1', transactionDate: '2026-10-16' });
    // Assert
    expect(laterSale.statusCode).toBe(201);
    expect(backdatedSale.statusCode).toBe(201);
    expect(transactionResultSchema.parse(backdatedSale.json()).holding.quantity).toBe('3');
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id },
      }),
    ).toBe(4);
    expect(fixture.used()).toBe(2);
  });

  it('should scope inventory to the wallet and symbol and conceal missing or foreign wallets', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({ quantity: '1' });
    const sibling = await fixture.createWallet(fixture.headers);
    const attacker = await createAuthenticatedUser(fixture.server, fixture.registeredEmails);
    // Act
    const emptyWallet = await fixture.sell({}, { url: `/api/wallets/${sibling.id}/transactions` });
    const emptySymbol = await fixture.sell({ symbol: 'UNKNOWN' });
    const foreign = await fixture.sell({}, { headers: attacker.headers });
    const missing = await fixture.sell({}, { url: `/api/wallets/${randomUUID()}/transactions` });
    // Assert
    for (const response of [emptyWallet, emptySymbol]) {
      expect(response.statusCode).toBe(409);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('INSUFFICIENT_HOLDING');
    }
    for (const response of [foreign, missing]) {
      expect(response.statusCode).toBe(404);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    }
    expect(
      await fixture.server.prisma.ledgerTransaction.count({ where: { symbol: fixture.symbol } }),
    ).toBe(1);
    expect(fixture.used()).toBe(1);
  });

  it.each([
    { quantity: '0' },
    { quantity: '-1' },
    { quantity: '0.000000001' },
    { quantity: 0.1 },
    { unitPrice: '1.000000001' },
    { unitPrice: '10000000000000000000000' },
    { currency: 'EUR' },
    { transactionDate: '2999-01-01' },
    { transactionDate: '2026-02-30' },
    { side: 'SHORT' },
    { userId: 'attacker' },
    { createdAt: '2026-10-18T00:00:00Z' },
  ])(
    'should reject invalid sale input without writes or provider dispatch: %j',
    async (changes) => {
      // Arrange
      const fixture = await createBuyLedgerFixture();
      // Act
      const response = await fixture.sell(changes);
      // Assert
      expect(response.statusCode).toBe(400);
      expect(
        await fixture.server.prisma.ledgerTransaction.count({
          where: { walletId: fixture.wallet.id },
        }),
      ).toBe(0);
      expect(fixture.used()).toBe(0);
    },
  );

  it('should require a session and trusted mutation origin for sales', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    // Act
    const unauthenticated = await fixture.sell({}, { headers: { origin: fixture.headers.origin } });
    const missingOrigin = await fixture.sell(
      {},
      { headers: { cookie: 'cookie' in fixture.headers ? fixture.headers.cookie : '' } },
    );
    // Assert
    expect(unauthenticated.statusCode).toBe(401);
    expect(missingOrigin.statusCode).toBe(403);
    expect(fixture.used()).toBe(0);
  });

  it('should sell stored holdings even when the market-data budget is exhausted', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture({}, { quotaLimit: 1 });
    await fixture.buy({ quantity: '1', transactionDate: '2026-10-17' });
    // Act
    const response = await fixture.sell({ quantity: '1' });
    // Assert
    expect(response.statusCode).toBe(201);
    expect(transactionResultSchema.parse(response.json()).holding.quantity).toBe('0');
    expect(fixture.used()).toBe(1);
    expect(fixture.requests).toHaveLength(1);
  });

  it('should sell previously recorded inventory without a provider key or reservation store', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture(
      {},
      { configureQuota: false, environment: { FMP_API_KEY: '' } },
    );
    await fixture.server.prisma.instrument.create({
      data: {
        symbol: fixture.symbol,
        name: 'Previously verified stock',
        exchange: 'NASDAQ',
        quoteCurrency: 'USD',
      },
    });
    await fixture.server.prisma.ledgerTransaction.create({
      data: {
        walletId: fixture.wallet.id,
        symbol: fixture.symbol,
        side: 'BUY',
        transactionDate: new Date('2026-10-17T00:00:00.000Z'),
        quantity: '1',
        unitPrice: '10',
        currency: 'USD',
      },
    });
    // Act
    const response = await fixture.sell({ quantity: '1' });
    // Assert
    expect(response.statusCode).toBe(201);
    expect(transactionResultSchema.parse(response.json()).holding.quantity).toBe('0');
    expect(fixture.used()).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should preserve sale immutability and cascade sales when their wallet is deleted', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({ quantity: '1', transactionDate: '2026-10-17' });
    const sale = transactionResultSchema.parse((await fixture.sell({ quantity: '1' })).json());
    // Assert
    await expect(
      fixture.server.prisma.ledgerTransaction.update({
        where: { id: sale.transaction.id },
        data: { unitPrice: '2' },
      }),
    ).rejects.toThrow();
    // Act
    const deleted = await fixture.server.inject({
      method: 'DELETE',
      url: `/api/wallets/${fixture.wallet.id}`,
      headers: fixture.headers,
    });
    // Assert
    expect(deleted.statusCode).toBe(204);
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id },
      }),
    ).toBe(0);
    expect(
      await fixture.server.prisma.instrument.count({ where: { symbol: fixture.symbol } }),
    ).toBe(1);
  });

  it('should sanitize unexpected sale persistence failures', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    vi.spyOn(fixture.server.prisma, '$transaction').mockRejectedValueOnce(
      new Error('private-sale-database-error'),
    );
    // Act
    const response = await fixture.sell();
    // Assert
    expect(response.statusCode).toBe(500);
    expect(response.payload).not.toContain('private-sale-database-error');
    expect(fixture.used()).toBe(0);
  });
});
