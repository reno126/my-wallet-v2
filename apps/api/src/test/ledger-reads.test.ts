import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorSchema,
  holdingSchema,
  transactionListSchema,
  walletHoldingsSchema,
} from '@my-wallets/contracts';

import { createAuthenticatedUser } from '../../test-support/authenticated-user.js';
import { createBuyLedgerFixture } from '../../test-support/buy-ledger.js';

describe('when reading ledger accounting and history', () => {
  it('should return an empty owned wallet without consulting market data', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture(
      {},
      { configureQuota: false, environment: { FMP_API_KEY: '' } },
    );
    // Act
    const summary = await readHoldings(fixture);
    const history = await readHistory(fixture);
    const unknown = await fixture.get(`${base(fixture)}/holdings/${fixture.symbol}`);
    // Assert
    expect(summary).toEqual({
      walletId: fixture.wallet.id,
      reportingCurrency: 'USD',
      remainingCostBasis: '0',
      realizedProfitLoss: '0',
      lastTransactionDate: null,
      holdings: [],
    });
    expect(history).toEqual({
      transactions: [],
      pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 },
    });
    expect(unknown.statusCode).toBe(404);
    expect(fixture.used()).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should aggregate FIFO cost and realized gains and losses across open and closed instruments', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.seedTransaction({
      quantity: '2',
      unitPrice: '10',
      transactionDate: new Date('2026-10-15'),
    });
    await fixture.seedTransaction({
      quantity: '1',
      unitPrice: '20',
      transactionDate: new Date('2026-10-16'),
    });
    const sale = await fixture.seedTransaction({
      side: 'SELL',
      quantity: '2.5',
      unitPrice: '30',
      transactionDate: new Date('2026-10-17'),
      description: 'FIFO partial sale',
    });
    const otherSymbol = `A${randomUUID().replaceAll('-', '').toUpperCase()}`;
    await fixture.seedTransaction({
      symbol: otherSymbol,
      unitPrice: '7',
      transactionDate: new Date('2026-10-15'),
    });
    await fixture.seedTransaction({ symbol: otherSymbol, side: 'SELL', unitPrice: '5' });
    // Act
    const summary = await readHoldings(fixture);
    const history = await readHistory(fixture);
    const detail = await readHolding(fixture);
    // Assert
    expect(summary).toMatchObject({
      remainingCostBasis: '10',
      realizedProfitLoss: '43',
      lastTransactionDate: '2026-10-18',
    });
    expect(summary.holdings.map(({ symbol }) => symbol)).toEqual([otherSymbol, fixture.symbol]);
    expect(summary.holdings[0]).toMatchObject({
      symbol: otherSymbol,
      quantity: '0',
      remainingCostBasis: '0',
      averageUnitCost: null,
      realizedProfitLoss: '-2',
    });
    expect(detail).toEqual({
      walletId: fixture.wallet.id,
      symbol: fixture.symbol,
      name: 'Verified stock',
      exchange: 'NASDAQ',
      quoteCurrency: 'USD',
      quantity: '0.5',
      remainingCostBasis: '10',
      averageUnitCost: '20',
      realizedProfitLoss: '45',
      lastTransactionDate: '2026-10-17',
    });
    expect(history.transactions.find(({ id }) => id === sale.id)).toMatchObject({
      totalAmount: '75',
      realizedProfitLoss: '45',
      canDelete: true,
      description: 'FIFO partial sale',
    });
    expect(history.transactions.filter(({ canDelete }) => canDelete)).toHaveLength(2);
    expect(
      history.transactions
        .filter(({ side }) => side === 'BUY')
        .every(({ realizedProfitLoss }) => realizedProfitLoss === null),
    ).toBe(true);
    expect(fixture.used()).toBe(0);
  });

  it('should retain realized results when a closed position is reopened', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.seedTransaction({ unitPrice: '10', transactionDate: new Date('2026-10-15') });
    await fixture.seedTransaction({
      side: 'SELL',
      unitPrice: '7',
      transactionDate: new Date('2026-10-16'),
    });
    const closed = await readHolding(fixture);
    // Act
    await fixture.seedTransaction({
      quantity: '0.5',
      unitPrice: '20',
      transactionDate: new Date('2026-10-17'),
    });
    const reopened = await readHolding(fixture);
    const history = await readHistory(fixture);
    // Assert
    expect(closed).toMatchObject({
      quantity: '0',
      averageUnitCost: null,
      realizedProfitLoss: '-3',
    });
    expect(reopened).toMatchObject({
      quantity: '0.5',
      remainingCostBasis: '10',
      averageUnitCost: '20',
      realizedProfitLoss: '-3',
    });
    expect(history.transactions[0]).toMatchObject({
      side: 'BUY',
      canDelete: true,
      realizedProfitLoss: null,
    });
  });

  it('should retain exact fractional products and average-cost division without presentation rounding', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.seedTransaction({
      quantity: '2',
      unitPrice: '10',
      transactionDate: new Date('2026-10-15'),
    });
    await fixture.seedTransaction({
      quantity: '1',
      unitPrice: '20',
      transactionDate: new Date('2026-10-16'),
    });
    const tiny = await fixture.seedTransaction({
      symbol: `T${randomUUID().replaceAll('-', '')}`,
      quantity: '0.00000001',
      unitPrice: '0.00000001',
    });
    // Act
    const detail = await readHolding(fixture);
    const summary = await readHoldings(fixture);
    const history = await readHistory(fixture);
    // Assert
    expect(detail.averageUnitCost).toMatch(/^13\.333333333333333333333333333333/);
    expect(summary.remainingCostBasis).toBe('40.0000000000000001');
    expect(history.transactions.find(({ id }) => id === tiny.id)?.totalAmount).toBe(
      '0.0000000000000001',
    );
  });

  it('should preserve products and totals beyond safe integers and the input column range', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const quantity = '9999999999999999999999.99999999';
    await fixture.seedTransaction({ quantity, unitPrice: quantity });
    // Act
    const summary = await readHoldings(fixture);
    const history = await readHistory(fixture);
    // Assert
    const product = '99999999999999999999999999999800000000000000.0000000000000001';
    expect(summary.holdings[0]?.quantity).toBe(quantity);
    expect(summary.remainingCostBasis).toBe(product);
    expect(history.transactions[0]?.totalAmount).toBe(product);
  });

  it('should order history newest first with creation timestamp and identifier tie-breaks', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const identifierPrefix = randomUUID().slice(0, -1);
    const oldest = await fixture.seedTransaction({
      transactionDate: new Date('2026-10-15'),
      createdAt: new Date('2026-10-20'),
    });
    const earlier = await fixture.seedTransaction({
      id: `${identifierPrefix}f`,
      createdAt: new Date('2026-10-19T11:59:59Z'),
    });
    const lower = await fixture.seedTransaction({ id: `${identifierPrefix}1` });
    const higher = await fixture.seedTransaction({ id: `${identifierPrefix}2` });
    // Act
    const history = await readHistory(fixture);
    // Assert
    expect(history.transactions.map(({ id }) => id)).toEqual([
      higher.id,
      lower.id,
      earlier.id,
      oldest.id,
    ]);
    expect(history.transactions.map(({ canDelete }) => canDelete)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(history.transactions[3]?.transactionDate).toBe('2026-10-15');
  });

  it('should paginate after FIFO replay and keep older pages nondeletable with case-insensitive filtering', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const buy = await fixture.seedTransaction({
      quantity: '2',
      transactionDate: new Date('2026-10-15'),
    });
    const sale = await fixture.seedTransaction({
      side: 'SELL',
      unitPrice: '15',
      transactionDate: new Date('2026-10-16'),
    });
    const latest = await fixture.seedTransaction({ transactionDate: new Date('2026-10-17') });
    await fixture.seedTransaction({ symbol: `Z${randomUUID().replaceAll('-', '')}` });
    // Act
    const query = `?symbol=${fixture.symbol.toLowerCase()}&pageSize=1`;
    const first = await readHistory(fixture, query);
    const second = await readHistory(fixture, `${query}&page=2`);
    const third = await readHistory(fixture, `${query}&page=3`);
    const past = await readHistory(fixture, `${query}&page=4`);
    const absent = await readHistory(fixture, '?symbol=UNKNOWN');
    // Assert
    expect(first.pagination).toEqual({ page: 1, pageSize: 1, totalCount: 3, totalPages: 3 });
    expect(first.transactions[0]).toMatchObject({ id: latest.id, canDelete: true });
    expect(second.transactions[0]).toMatchObject({
      id: sale.id,
      canDelete: false,
      realizedProfitLoss: '5',
    });
    expect(third.transactions[0]).toMatchObject({
      id: buy.id,
      canDelete: false,
      realizedProfitLoss: null,
    });
    expect(past.transactions).toEqual([]);
    expect(past.pagination.totalCount).toBe(3);
    expect(absent.pagination.totalCount).toBe(0);
  });

  it('should reflect committed deletion and corrected re-entry and reject a stale delete flag', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const first = await fixture.seedTransaction({
      quantity: '2',
      transactionDate: new Date('2026-10-15'),
    });
    const sale = await fixture.seedTransaction({
      side: 'SELL',
      unitPrice: '15',
      transactionDate: new Date('2026-10-16'),
    });
    const displayed = await readHistory(fixture);
    // Act
    const deleted = await fixture.deleteTransaction(sale.id);
    const restored = await readHoldings(fixture);
    const history = await readHistory(fixture);
    const replacement = await fixture.sell({
      quantity: '0.5',
      unitPrice: '8',
      transactionDate: '2026-10-17',
    });
    const corrected = await readHoldings(fixture);
    const stale = await fixture.deleteTransaction(first.id);
    // Assert
    expect(displayed.transactions[0]).toMatchObject({ id: sale.id, canDelete: true });
    expect(deleted.statusCode).toBe(204);
    expect(restored.holdings[0]).toMatchObject({
      quantity: '2',
      remainingCostBasis: '20',
      realizedProfitLoss: '0',
    });
    expect(history.transactions).toHaveLength(1);
    expect(history.transactions[0]).toMatchObject({ id: first.id, canDelete: true });
    expect(replacement.statusCode).toBe(201);
    expect(corrected.holdings[0]).toMatchObject({
      quantity: '1.5',
      remainingCostBasis: '15',
      realizedProfitLoss: '-1',
      lastTransactionDate: '2026-10-17',
    });
    expect(stale.statusCode).toBe(409);
  });

  it('should remove a position when its final transaction is deleted while preserving shared metadata', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const row = await fixture.seedTransaction();
    // Act
    await fixture.deleteTransaction(row.id);
    const summary = await readHoldings(fixture);
    const detail = await fixture.get(`${base(fixture)}/holdings/${fixture.symbol}`);
    // Assert
    expect(summary.holdings).toEqual([]);
    expect(summary.lastTransactionDate).toBeNull();
    expect(detail.statusCode).toBe(404);
    expect(
      await fixture.server.prisma.instrument.findUnique({ where: { symbol: fixture.symbol } }),
    ).not.toBeNull();
  });

  it('should scope summaries, symbol history and instrument details to one owned wallet', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const other = await createAuthenticatedUser(fixture.server, fixture.registeredEmails);
    const sibling = await fixture.createWallet(fixture.headers);
    const foreign = await fixture.createWallet(other.headers);
    await fixture.seedTransaction();
    await fixture.seedTransaction({ walletId: sibling.id, quantity: '100' });
    await fixture.seedTransaction({ walletId: foreign.id, quantity: '1000' });
    // Act
    const summary = await readHoldings(fixture);
    const history = await readHistory(fixture);
    // Assert
    expect(summary.holdings[0]?.quantity).toBe('1');
    expect(history.pagination.totalCount).toBe(1);
    for (const walletId of [foreign.id, randomUUID()]) {
      for (const suffix of ['/holdings', `/holdings/${fixture.symbol}`, '/transactions']) {
        const response = await fixture.get(`/api/wallets/${walletId}${suffix}`);
        expect(response.statusCode).toBe(404);
        expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
      }
    }
  });

  it('should accept uppercase wallet identifiers and lowercase instrument identifiers', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.seedTransaction();
    const path = `/api/wallets/${fixture.wallet.id.toUpperCase()}`;
    // Act
    const summary = await fixture.get(`${path}/holdings`);
    const detail = await fixture.get(`${path}/holdings/${fixture.symbol.toLowerCase()}`);
    const history = await fixture.get(`${path}/transactions`);
    // Assert
    expect(walletHoldingsSchema.parse(summary.json()).walletId).toBe(fixture.wallet.id);
    expect(holdingSchema.parse(detail.json()).symbol).toBe(fixture.symbol);
    expect(transactionListSchema.parse(history.json()).transactions[0]?.walletId).toBe(
      fixture.wallet.id,
    );
  });

  it('should require a session on every read endpoint', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture({}, { authenticate: false });
    // Assert
    for (const suffix of ['/holdings', `/holdings/${fixture.symbol}`, '/transactions']) {
      const response = await fixture.get(`${base(fixture)}${suffix}`);
      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('should reject invalid identifiers, malformed symbols and unrecognized history filters', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    // Assert
    for (const path of [
      '/api/wallets/invalid/holdings',
      '/api/wallets/invalid/transactions',
      `${base(fixture)}/holdings/INVALID%20SYMBOL`,
      `${fixture.url}?page=0`,
      `${fixture.url}?pageSize=101`,
      `${fixture.url}?symbol=INVALID%20SYMBOL`,
      `${fixture.url}?userId=other`,
    ]) {
      const response = await fixture.get(path);
      expect(response.statusCode).toBe(400);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('should sanitize database errors and fail closed on an invalid persisted ledger', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const read = vi
      .spyOn(fixture.server.prisma, '$transaction')
      .mockRejectedValueOnce(new Error('private-ledger-error'));
    // Act
    const databaseFailure = await fixture.get(`${base(fixture)}/holdings`);
    read.mockRestore();
    await fixture.seedTransaction({ side: 'SELL' });
    const invalidLedger = await fixture.get(`${base(fixture)}/holdings`);
    // Assert
    for (const response of [databaseFailure, invalidLedger]) {
      expect(response.statusCode).toBe(500);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(response.payload).not.toContain('private-ledger-error');
      expect(response.payload).not.toContain('persisted ledger');
    }
  });

  it('should apply private rate limits to all ledger read routes', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture(
      {},
      { environment: { API_AUTHENTICATED_RATE_LIMIT_MAX: '1' } },
    );
    // Assert
    for (const suffix of ['/holdings', `/holdings/${fixture.symbol}`, '/transactions']) {
      const response = await fixture.get(`${base(fixture)}${suffix}`);
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
    }
  });

  it('should read the committed ledger while a deletion holds the wallet write lock', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.seedTransaction({ quantity: '2', transactionDate: new Date('2026-10-15') });
    const sale = await fixture.seedTransaction({ side: 'SELL', unitPrice: '15' });
    let release = () => {};
    let notify = () => {};
    const held = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deletion = fixture.server.prisma.$transaction(
      async (database) => {
        await database.$queryRaw`SELECT "id" FROM "wallet" WHERE "id" = ${fixture.wallet.id}::uuid FOR UPDATE`;
        await database.ledgerTransaction.delete({ where: { id: sale.id } });
        notify();
        await released;
      },
      { timeout: 10_000 },
    );
    await Promise.race([held, deletion]);
    // Act
    try {
      const summary = await readHoldings(fixture);
      const history = await readHistory(fixture);
      // Assert
      expect(summary.holdings[0]).toMatchObject({ quantity: '1', realizedProfitLoss: '5' });
      expect(history.transactions[0]).toMatchObject({ id: sale.id, canDelete: true });
    } finally {
      release();
      await deletion;
    }
    expect((await readHoldings(fixture)).holdings[0]).toMatchObject({
      quantity: '2',
      realizedProfitLoss: '0',
    });
    expect((await readHistory(fixture)).transactions).toHaveLength(1);
  });
});

type LedgerFixture = Awaited<ReturnType<typeof createBuyLedgerFixture>>;

function base(fixture: LedgerFixture): string {
  return `/api/wallets/${fixture.wallet.id}`;
}

async function readHoldings(fixture: LedgerFixture) {
  const response = await fixture.get(`${base(fixture)}/holdings`);
  expect(response.statusCode).toBe(200);
  return walletHoldingsSchema.parse(response.json());
}

async function readHolding(fixture: LedgerFixture) {
  const response = await fixture.get(`${base(fixture)}/holdings/${fixture.symbol}`);
  expect(response.statusCode).toBe(200);
  return holdingSchema.parse(response.json());
}

async function readHistory(fixture: LedgerFixture, query = '') {
  const response = await fixture.get(`${fixture.url}${query}`);
  expect(response.statusCode).toBe(200);
  return transactionListSchema.parse(response.json());
}
