import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { apiErrorSchema, transactionResultSchema } from '@my-wallets/contracts';

import { createAuthenticatedUser } from '../../test-support/authenticated-user.js';
import { createBuyLedgerFixture } from '../../test-support/buy-ledger.js';

describe('when permanently deleting the latest transaction', () => {
  it('should delete the latest sale and replay its lots before a corrected sale is re-entered', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const first = transactionResultSchema.parse(
      (await fixture.buy({ quantity: '2', unitPrice: '10', transactionDate: '2026-10-16' })).json(),
    );
    await fixture.buy({ quantity: '1', unitPrice: '20', transactionDate: '2026-10-17' });
    const sale = transactionResultSchema.parse(
      (await fixture.sell({ quantity: '2.5', unitPrice: '30' })).json(),
    );
    const before = await fixture.readPosition();
    // Act
    const deleted = await fixture.deleteTransaction(sale.transaction.id);
    const restored = await fixture.readPosition();
    const replacement = await fixture.sell({ quantity: '1.5', unitPrice: '30' });
    const corrected = await fixture.readPosition();
    // Assert
    expect(deleted.statusCode).toBe(204);
    expect(before).toMatchObject({
      quantity: '0.5',
      remainingCostBasis: '10',
      realizedProfitLoss: '45',
    });
    expect(restored).toMatchObject({
      quantity: '3',
      remainingCostBasis: '40',
      realizedProfitLoss: '0',
      sales: [],
    });
    expect(restored.averageUnitCost).toMatch(/^13\.333333333333333333/);
    expect(replacement.statusCode).toBe(201);
    expect(transactionResultSchema.parse(replacement.json()).transaction.id).not.toBe(
      sale.transaction.id,
    );
    expect(corrected).toMatchObject({
      quantity: '1.5',
      remainingCostBasis: '25',
      realizedProfitLoss: '30',
      lots: [{ transactionId: first.transaction.id, quantity: '0.5' }, { quantity: '1' }],
    });
    expect(
      await fixture.server.prisma.ledgerTransaction.findUnique({
        where: { id: sale.transaction.id },
      }),
    ).toBeNull();
    expect(fixture.used()).toBe(2);
  });

  it('should reject an older entry without removing it or dependent newer trades', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const buy = await fixture.seedTransaction({ transactionDate: new Date('2026-10-16') });
    await fixture.seedTransaction({
      side: 'SELL',
      quantity: '0.5',
      transactionDate: new Date('2026-10-17'),
    });
    const before = await fixture.server.prisma.ledgerTransaction.findMany({
      where: { walletId: fixture.wallet.id },
      orderBy: { id: 'asc' },
    });
    // Act
    const response = await fixture.deleteTransaction(buy.id);
    // Assert
    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('CONFLICT');
    expect(
      await fixture.server.prisma.ledgerTransaction.findMany({
        where: { walletId: fixture.wallet.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(fixture.used()).toBe(0);
  });

  it.each([
    {
      dimension: 'transaction date',
      older: {
        transactionDate: new Date('2026-10-16'),
        createdAt: new Date('2026-10-20T12:00:00Z'),
      },
      newer: {
        transactionDate: new Date('2026-10-17'),
        createdAt: new Date('2026-10-19T12:00:00Z'),
      },
    },
    {
      dimension: 'creation time',
      older: {
        createdAt: new Date('2026-10-19T12:00:00Z'),
        id: '00000000-0000-4000-8000-00000000000f',
      },
      newer: {
        createdAt: new Date('2026-10-19T12:00:00.001Z'),
        id: '00000000-0000-4000-8000-00000000000a',
      },
    },
    {
      dimension: 'identifier',
      older: { id: '00000000-0000-4000-8000-00000000000a' },
      newer: { id: '00000000-0000-4000-8000-00000000000f' },
    },
  ])(
    'should enforce latest eligibility by $dimension in the shared total order',
    async ({ older, newer }) => {
      // Arrange
      const fixture = await createBuyLedgerFixture();
      const first = await fixture.seedTransaction(older);
      const last = await fixture.seedTransaction(newer);
      // Act
      const rejected = await fixture.deleteTransaction(first.id);
      const removedLatest = await fixture.deleteTransaction(last.id.toUpperCase());
      const removedPrevious = await fixture.deleteTransaction(first.id);
      // Assert
      expect(rejected.statusCode).toBe(409);
      expect(removedLatest.statusCode).toBe(204);
      expect(removedPrevious.statusCode).toBe(204);
      expect(
        await fixture.server.prisma.ledgerTransaction.count({
          where: { walletId: fixture.wallet.id },
        }),
      ).toBe(0);
    },
  );

  it('should determine latest per instrument and preserve shared instruments and other wallets', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const sibling = await fixture.createWallet(fixture.headers);
    const selected = await fixture.seedTransaction({ quantity: '0.00000001' });
    const otherSymbol = `S${fixture.symbol}`;
    const other = await fixture.seedTransaction({
      symbol: otherSymbol,
      transactionDate: new Date('2026-10-19'),
    });
    const siblingTrade = await fixture.seedTransaction({
      walletId: sibling.id,
      transactionDate: new Date('2026-10-19'),
    });
    // Act
    const response = await fixture.deleteTransaction(selected.id);
    const remaining = await fixture.readPosition();
    // Assert
    expect(response.statusCode).toBe(204);
    expect(remaining).toMatchObject({
      quantity: '0',
      remainingCostBasis: '0',
      averageUnitCost: null,
      realizedProfitLoss: '0',
      lots: [],
      sales: [],
    });
    expect(
      await fixture.server.prisma.ledgerTransaction.findUnique({ where: { id: other.id } }),
    ).toEqual(other);
    expect(
      await fixture.server.prisma.ledgerTransaction.findUnique({ where: { id: siblingTrade.id } }),
    ).toEqual(siblingTrade);
    expect(
      await fixture.server.prisma.instrument.findUnique({ where: { symbol: fixture.symbol } }),
    ).not.toBeNull();
    expect(fixture.used()).toBe(0);
  });

  it('should conceal foreign wallets and transactions outside the selected wallet', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const row = await fixture.seedTransaction();
    const attacker = await createAuthenticatedUser(fixture.server, fixture.registeredEmails);
    const sibling = await fixture.createWallet(fixture.headers);
    // Act
    const responses = await Promise.all([
      fixture.deleteTransaction(row.id, { headers: attacker.headers }),
      fixture.deleteTransaction(row.id, {
        url: `/api/wallets/${sibling.id}/transactions/${row.id}`,
      }),
      fixture.deleteTransaction(row.id, {
        url: `/api/wallets/${randomUUID()}/transactions/${row.id}`,
      }),
      fixture.deleteTransaction(randomUUID()),
    ]);
    // Assert
    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    }
    expect(
      await fixture.server.prisma.ledgerTransaction.findUnique({ where: { id: row.id } }),
    ).toEqual(row);
    expect(fixture.used()).toBe(0);
  });

  it('should require authentication, a trusted mutation origin, and valid UUID parameters', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const row = await fixture.seedTransaction();
    // Act
    const unauthenticated = await fixture.deleteTransaction(row.id, {
      headers: { origin: fixture.headers.origin },
    });
    const missingOrigin = await fixture.deleteTransaction(row.id, {
      headers: { cookie: 'cookie' in fixture.headers ? fixture.headers.cookie : '' },
    });
    const invalidWallet = await fixture.deleteTransaction(row.id, {
      url: `/api/wallets/invalid/transactions/${row.id}`,
    });
    const invalidTransaction = await fixture.deleteTransaction('invalid');
    // Assert
    expect(unauthenticated.statusCode).toBe(401);
    expect(missingOrigin.statusCode).toBe(403);
    expect(invalidWallet.statusCode).toBe(400);
    expect(invalidTransaction.statusCode).toBe(400);
    expect(
      await fixture.server.prisma.ledgerTransaction.findUnique({ where: { id: row.id } }),
    ).toEqual(row);
  });

  it('should delete without provider configuration and return not found on a repeated request', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture(
      {},
      { configureQuota: false, environment: { FMP_API_KEY: '' } },
    );
    const row = await fixture.seedTransaction();
    // Act
    const deleted = await fixture.deleteTransaction(row.id);
    const repeated = await fixture.deleteTransaction(row.id);
    // Assert
    expect(deleted.statusCode).toBe(204);
    expect(repeated.statusCode).toBe(404);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should roll back deletion if the remaining ledger cannot be replayed', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.seedTransaction({ transactionDate: new Date('2026-10-15') });
    await fixture.seedTransaction({
      side: 'SELL',
      quantity: '2',
      transactionDate: new Date('2026-10-16'),
    });
    const last = await fixture.seedTransaction({ transactionDate: new Date('2026-10-17') });
    const before = await fixture.server.prisma.ledgerTransaction.findMany({
      where: { walletId: fixture.wallet.id },
      orderBy: { id: 'asc' },
    });
    // Act
    const response = await fixture.deleteTransaction(last.id);
    // Assert
    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('INSUFFICIENT_HOLDING');
    expect(
      await fixture.server.prisma.ledgerTransaction.findMany({
        where: { walletId: fixture.wallet.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it('should validate a backdated sale against remaining sales after deletion and re-entry', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.seedTransaction({ transactionDate: new Date('2026-10-15') });
    const sale = await fixture.seedTransaction({
      side: 'SELL',
      transactionDate: new Date('2026-10-17'),
    });
    const latest = await fixture.seedTransaction({ transactionDate: new Date('2026-10-18') });
    const deleted = await fixture.deleteTransaction(latest.id);
    const reentered = await fixture.buy({ quantity: '1', transactionDate: '2026-10-19' });
    const before = await fixture.server.prisma.ledgerTransaction.findMany({
      where: { walletId: fixture.wallet.id },
      orderBy: { id: 'asc' },
    });
    // Act
    const rejected = await fixture.sell({ quantity: '0.00000001', transactionDate: '2026-10-16' });
    // Assert
    expect(deleted.statusCode).toBe(204);
    expect(reentered.statusCode).toBe(201);
    expect(rejected.statusCode).toBe(409);
    expect(apiErrorSchema.parse(rejected.json()).error.code).toBe('INSUFFICIENT_HOLDING');
    expect(
      await fixture.server.prisma.ledgerTransaction.findMany({
        where: { walletId: fixture.wallet.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(before.some((entry) => entry.id === sale.id)).toBe(true);
    expect((await fixture.readPosition()).quantity).toBe('1');
  });

  it('should sanitize unexpected persistence failures', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const row = await fixture.seedTransaction();
    const failingWrite = vi
      .spyOn(fixture.server.prisma, '$transaction')
      .mockRejectedValueOnce(new Error('private-delete-database-error'));
    // Act
    const response = await fixture.deleteTransaction(row.id);
    // Assert
    expect(response.statusCode).toBe(500);
    expect(response.payload).not.toContain('private-delete-database-error');
    failingWrite.mockRestore();
    expect(
      await fixture.server.prisma.ledgerTransaction.findUnique({ where: { id: row.id } }),
    ).toEqual(row);
  });

  it('should apply the private request limit before deleting a transaction', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture(
      {},
      { environment: { API_AUTHENTICATED_RATE_LIMIT_MAX: '1' } },
    );
    const row = await fixture.seedTransaction();
    // Act
    const response = await fixture.deleteTransaction(row.id);
    // Assert
    expect(response.statusCode).toBe(429);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
    expect(
      await fixture.server.prisma.ledgerTransaction.findUnique({ where: { id: row.id } }),
    ).toEqual(row);
    expect(fixture.used()).toBe(0);
  });

  it('should use persisted identifiers when creating and deleting through uppercase UUID URLs', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.seedTransaction({ transactionDate: new Date('2026-10-16') });
    const path = `/api/wallets/${fixture.wallet.id.toUpperCase()}/transactions`;
    // Act
    const created = await fixture.buy({ transactionDate: '2026-10-17' }, { url: path });
    // Assert
    expect(created.statusCode).toBe(201);
    const trade = transactionResultSchema.parse(created.json()).transaction;
    // Act
    const deleted = await fixture.deleteTransaction(trade.id, {
      url: `${path}/${trade.id.toUpperCase()}`,
    });
    // Assert
    expect(deleted.statusCode).toBe(204);
    expect((await fixture.readPosition()).quantity).toBe('1');
  });
});
