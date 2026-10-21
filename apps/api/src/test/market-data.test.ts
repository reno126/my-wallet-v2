import { randomUUID } from 'node:crypto';

import { describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  apiErrorSchema,
  holdingValuationSchema,
  priceRefreshReceiptSchema,
  providerQuotaStatusSchema,
  walletRefreshStatusSchema,
  walletValuationSchema,
} from '@my-wallets/contracts';

import { createAuthenticatedUser } from '../../test-support/authenticated-user.ts';
import { deferred } from '../../test-support/deferred.ts';
import { createMarketDataFixture } from '../../test-support/market-data.ts';

describe('when exposing cached valuations and shared price refreshes', () => {
  it('should return empty and closed valuation without provider configuration or dispatch', async () => {
    // Arrange
    const fixture = await createMarketDataFixture({ environment: { FMP_API_KEY: '' } });
    // Act
    const emptyResponse = await fixture.get(`${fixture.base}/valuation`);
    expect(emptyResponse.statusCode, emptyResponse.body).toBe(200);
    const empty = walletValuationSchema.parse(emptyResponse.json());
    const purchase = await fixture.seedTransaction();
    await fixture.seedTransaction({
      side: 'SELL',
      createdAt: new Date(purchase.createdAt.getTime() + 1),
    });
    const closedResponse = await fixture.get(`${fixture.base}/valuation`);
    expect(closedResponse.statusCode, closedResponse.body).toBe(200);
    const closed = walletValuationSchema.parse(closedResponse.json());
    const requested = await fixture.refresh();
    // Assert
    expect(empty).toMatchObject({
      currentValue: '0',
      unrealizedProfitLoss: '0',
      holdings: [],
      freshness: 'not_required',
    });
    expect(closed).toMatchObject({
      currentValue: '0',
      unrealizedProfitLoss: '0',
      freshness: 'not_required',
    });
    expect(requested.statusCode).toBe(202);
    expect(priceRefreshReceiptSchema.parse(requested.json()).requestedSymbols).toEqual([]);
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
  });

  it('should combine exact remaining FIFO cost with the latest market-date snapshot and per-holding allocation', async () => {
    // Arrange
    const fixture = await createMarketDataFixture();
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
    });
    await fixture.savePrice();
    await fixture.savePrice({
      marketDate: '2026-10-10',
      unitPrice: '999',
      retrievedAt: new Date(Date.now() + 1000),
    });
    // Act
    const response = await fixture.get(`${fixture.base}/valuation`);
    const wallet = walletValuationSchema.parse(response.json());
    const detail = holdingValuationSchema.parse(
      (await fixture.get(`${fixture.base}/valuation/${fixture.symbol.toLowerCase()}`)).json(),
    );
    // Assert
    expect(response.statusCode).toBe(200);
    expect(wallet).toMatchObject({
      remainingCostBasis: '10',
      realizedProfitLoss: '45',
      currentValue: '12.5',
      unrealizedProfitLoss: '2.5',
      unrealizedProfitLossPercentage: '25',
      freshness: 'fresh',
    });
    expect(detail).toMatchObject({
      quantity: '0.5',
      averageUnitCost: '20',
      currentValue: '12.5',
      allocationPercentage: '100',
      price: { unitPrice: '25', currency: 'USD', source: 'FMP' },
    });
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
    expect((await fixture.quota.read()).used).toBe(0);

    // Act
    const deleted = await fixture.deleteTransaction(sale.id);
    const corrected = walletValuationSchema.parse(
      (await fixture.get(`${fixture.base}/valuation`)).json(),
    );
    // Assert
    expect(deleted.statusCode).toBe(204);
    expect(corrected).toMatchObject({
      remainingCostBasis: '40',
      realizedProfitLoss: '0',
      currentValue: '75',
      unrealizedProfitLoss: '35',
    });
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
  });

  it('should preserve stale values and distinguish a missing position from zero when totals are incomplete', async () => {
    // Arrange
    const fixture = await createMarketDataFixture();
    await fixture.seedTransaction();
    const missingSymbol = `M${randomUUID().replaceAll('-', '').toUpperCase()}`;
    await fixture.seedTransaction({ symbol: missingSymbol });
    await fixture.savePrice({
      marketDate: '2026-10-01',
      retrievedAt: new Date('2026-10-01T17:00:00Z'),
    });
    // Act
    const result = walletValuationSchema.parse(
      (await fixture.get(`${fixture.base}/valuation`)).json(),
    );
    // Assert
    expect(result).toMatchObject({
      freshness: 'missing',
      currentValue: null,
      unrealizedProfitLoss: null,
    });
    expect(result.holdings.find((holding) => holding.symbol === fixture.symbol)).toMatchObject({
      currentValue: '25',
      freshness: 'stale',
      allocationPercentage: null,
    });
    expect(result.holdings.find((holding) => holding.symbol === missingSymbol)).toMatchObject({
      price: null,
      currentValue: null,
      freshness: 'missing',
    });
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
  });

  it('should return refresh receipts and pending status before a slow provider finishes and share one dispatch across wallets', async () => {
    // Arrange
    const fixture = await createMarketDataFixture();
    await fixture.seedTransaction();
    const secondWallet = await fixture.createWallet(fixture.headers);
    await fixture.seedTransaction({ walletId: secondWallet.id });
    const release = deferred<void>();
    onTestFinished(() => release.resolve());
    const started = deferred<void>();
    fixture.fetchRequest.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return Response.json([{ symbol: fixture.symbol, currency: 'USD' }]);
    });
    // Act
    const responses = await Promise.all([
      fixture.refresh(),
      fixture.refresh(`/api/wallets/${secondWallet.id}/price-refresh`),
      fixture.refresh(),
    ]);
    await started.promise;
    const status = walletRefreshStatusSchema.parse(
      (await fixture.get(`${fixture.base}/price-refresh`)).json(),
    );
    const before = walletValuationSchema.parse(
      (await fixture.get(`${fixture.base}/valuation`)).json(),
    );
    // Assert
    expect(responses.every((response) => response.statusCode === 202)).toBe(true);
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({
      hasPendingWork: true,
      freshness: 'missing',
      holdings: [{ status: 'running' }],
    });
    expect(before.currentValue).toBeNull();
    // Act
    release.resolve();
    await fixture.server.priceRefresh.enqueue(fixture.symbol);
    const after = walletValuationSchema.parse(
      (await fixture.get(`${fixture.base}/valuation`)).json(),
    );
    const repeated = await fixture.refresh();
    // Assert
    expect(after).toMatchObject({
      currentValue: '25',
      unrealizedProfitLoss: '15',
      freshness: 'fresh',
    });
    expect(priceRefreshReceiptSchema.parse(repeated.json()).requestedSymbols).toEqual([]);
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(2);
    expect((await fixture.quota.read()).used).toBe(2);
    expect(
      await fixture.server.prisma.refreshSubscription.count({ where: { symbol: fixture.symbol } }),
    ).toBe(2);
  });

  it('should keep stale data readable after durable quota exhaustion without refunding the dispatched profile', async () => {
    // Arrange
    const fixture = await createMarketDataFixture({ limit: 1 });
    await fixture.seedTransaction();
    await fixture.savePrice({
      marketDate: '2026-10-01',
      retrievedAt: new Date('2026-10-01T17:00:00Z'),
    });
    // Act
    expect((await fixture.refresh()).statusCode).toBe(202);
    await fixture.server.priceRefresh.enqueue(fixture.symbol);
    const value = walletValuationSchema.parse(
      (await fixture.get(`${fixture.base}/valuation`)).json(),
    );
    const status = walletRefreshStatusSchema.parse(
      (await fixture.get(`${fixture.base}/price-refresh`)).json(),
    );
    const exhausted = await fixture.refresh();
    const quotaStatus = providerQuotaStatusSchema.parse(
      (await fixture.get('/api/market-data/quota')).json(),
    );
    await fixture.server.priceRefresh.enqueue(fixture.symbol);
    // Assert
    expect(value).toMatchObject({ currentValue: '25', freshness: 'stale' });
    expect(status).toMatchObject({
      hasPendingWork: false,
      holdings: [{ status: 'failed', lastFailureCode: 'PROVIDER_QUOTA_EXHAUSTED' }],
    });
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(1);
    expect((await fixture.quota.read()).used).toBe(1);
    expect(exhausted.statusCode).toBe(503);
    expect(apiErrorSchema.parse(exhausted.json()).error.code).toBe('PROVIDER_QUOTA_EXHAUSTED');
    expect(quotaStatus).toMatchObject({ limit: 1, used: 1, remaining: 0, exhausted: true });
  });

  it('should retain pending demand without claiming activity or admitting new work when the shared budget is exhausted', async () => {
    // Arrange
    const fixture = await createMarketDataFixture({ limit: 1 });
    await fixture.seedTransaction();
    await fixture.server.prisma.refreshWork.create({
      data: {
        symbol: fixture.symbol,
        requestedAt: new Date(),
        updatedAt: new Date(),
        subscriptions: { create: { walletId: fixture.wallet.id } },
      },
    });
    await fixture.quota.reserveRequest();
    // Act
    const status = walletRefreshStatusSchema.parse(
      (await fixture.get(`${fixture.base}/price-refresh`)).json(),
    );
    const quota = providerQuotaStatusSchema.parse(
      (await fixture.get('/api/market-data/quota')).json(),
    );
    const response = await fixture.refresh();
    // Assert
    expect(status).toMatchObject({ hasPendingWork: true, holdings: [{ status: 'pending' }] });
    expect(quota).toMatchObject({ limit: 1, used: 1, remaining: 0, exhausted: true });
    expect(response.statusCode).toBe(503);
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
    expect(
      await fixture.server.prisma.refreshWork.findUniqueOrThrow({
        where: { symbol: fixture.symbol },
      }),
    ).toMatchObject({ status: 'PENDING', attempts: 0 });
  });

  it('should retain stale prices and safe terminal failure status after a non-retryable provider error', async () => {
    // Arrange
    const fixture = await createMarketDataFixture();
    await fixture.seedTransaction();
    await fixture.savePrice({
      marketDate: '2026-10-01',
      retrievedAt: new Date('2026-10-01T17:00:00Z'),
    });
    fixture.fetchRequest.mockResolvedValueOnce(
      Response.json({ privateDetails: 'provider-body' }, { status: 401 }),
    );
    // Act
    await fixture.refresh();
    await fixture.server.priceRefresh.enqueue(fixture.symbol);
    const value = walletValuationSchema.parse(
      (await fixture.get(`${fixture.base}/valuation`)).json(),
    );
    const response = await fixture.get(`${fixture.base}/price-refresh`);
    const status = walletRefreshStatusSchema.parse(response.json());
    // Assert
    expect(value).toMatchObject({ currentValue: '25', freshness: 'stale' });
    expect(status).toMatchObject({ hasPendingWork: false, holdings: [{ status: 'failed' }] });
    expect(response.payload).not.toContain('provider-body');
    expect(response.payload).not.toContain('leaseToken');
    expect((await fixture.quota.read()).used).toBe(1);
  });

  it('should cap competing distinct-symbol refreshes at the final durable quota reservation', async () => {
    // Arrange
    const fixture = await createMarketDataFixture({ limit: 1 });
    const other = `Q${randomUUID().replaceAll('-', '').toUpperCase()}`;
    await fixture.seedTransaction();
    await fixture.seedTransaction({ symbol: other });
    // Act
    const response = await fixture.refresh();
    await Promise.all([
      fixture.server.priceRefresh.enqueue(fixture.symbol),
      fixture.server.priceRefresh.enqueue(other),
    ]);
    const status = walletRefreshStatusSchema.parse(
      (await fixture.get(`${fixture.base}/price-refresh`)).json(),
    );
    // Assert
    expect(response.statusCode).toBe(202);
    expect(priceRefreshReceiptSchema.parse(response.json()).requestedSymbols).toHaveLength(2);
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(1);
    expect(await fixture.quota.read()).toMatchObject({ used: 1, remaining: 0 });
    expect(
      status.holdings.every(
        (holding) =>
          holding.status === 'failed' && holding.lastFailureCode === 'PROVIDER_QUOTA_EXHAUSTED',
      ),
    ).toBe(true);
    expect(status.hasPendingWork).toBe(false);
  });

  it('should isolate wallet ownership, unknown symbols and mutation origins before any dispatch', async () => {
    // Arrange
    const fixture = await createMarketDataFixture();
    await fixture.seedTransaction();
    const other = await createAuthenticatedUser(fixture.server, fixture.registeredEmails);
    // Act
    for (const path of ['/valuation', '/price-refresh', `/valuation/${fixture.symbol}`]) {
      const response = await fixture.server.inject({
        method: 'GET',
        url: `${fixture.base}${path}`,
        headers: other.headers,
      });
      fixture.contract.assertResponse('get', `${fixture.base}${path}`, response);
      expect(response.statusCode).toBe(404);
    }
    const foreign = await fixture.refresh(`${fixture.base}/price-refresh`, other.headers);
    const forbidden = await fixture.refresh(`${fixture.base}/price-refresh`, {
      ...fixture.headers,
      origin: 'https://attacker.example',
    });
    const unknown = await fixture.get(`${fixture.base}/valuation/UNKNOWN`);
    const invalid = await fixture.get('/api/wallets/not-a-uuid/valuation');
    // Assert
    expect(foreign.statusCode).toBe(404);
    expect(forbidden.statusCode).toBe(403);
    expect(unknown.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
    expect(
      await fixture.server.prisma.refreshSubscription.count({ where: { symbol: fixture.symbol } }),
    ).toBe(0);
  });

  it('should expose tracked quota configuration and resets without outbound requests', async () => {
    // Arrange
    const fixture = await createMarketDataFixture({ environment: { FMP_API_KEY: '' } });
    // Act
    const first = providerQuotaStatusSchema.parse(
      (await fixture.get('/api/market-data/quota')).json(),
    );
    const second = providerQuotaStatusSchema.parse(
      (await fixture.get('/api/market-data/quota')).json(),
    );
    await fixture.seedTransaction();
    const unavailable = await fixture.refresh();
    // Assert
    expect(first).toMatchObject({
      provider: 'FMP',
      configured: false,
      limit: 250,
      timeZone: 'America/New_York',
    });
    expect(second.used).toBe(first.used);
    expect(second.remaining).toBe(first.remaining);
    expect(unavailable.statusCode).toBe(503);
    expect(apiErrorSchema.parse(unavailable.json()).error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
  });

  it('should require authentication for all new reads and refresh requests', async () => {
    // Arrange
    const fixture = await createMarketDataFixture({ authenticate: false });
    // Act
    for (const path of [
      `${fixture.base}/valuation`,
      `${fixture.base}/price-refresh`,
      `${fixture.base}/valuation/${fixture.symbol}`,
      '/api/market-data/quota',
    ]) {
      const response = await fixture.get(path);
      expect(response.statusCode).toBe(401);
    }
    const response = await fixture.refresh();
    // Assert
    expect(response.statusCode).toBe(401);
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
  });

  it('should reject caller-selected symbols and preserve authenticated rate limits', async () => {
    // Arrange
    const fixture = await createMarketDataFixture({
      environment: { API_AUTHENTICATED_RATE_LIMIT_MAX: '2' },
    });
    const url = `${fixture.base}/price-refresh`;
    // Act
    const invalid = await fixture.server.inject({
      method: 'POST',
      url,
      headers: fixture.headers,
      payload: { symbols: ['OTHER'], force: true },
    });
    fixture.contract.assertResponse('post', url, invalid);
    const first = await fixture.get(`${fixture.base}/valuation`);
    const limited = await fixture.get(`${fixture.base}/price-refresh`);
    // Assert
    expect(invalid.statusCode).toBe(400);
    expect(first.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
  });

  it('should sanitize unexpected read failures using the shared API error contract', async () => {
    // Arrange
    const fixture = await createMarketDataFixture();
    vi.spyOn(fixture.server.marketData, 'valuation').mockRejectedValueOnce(
      new Error('private-storage-details'),
    );
    // Act
    const response = await fixture.get(`${fixture.base}/valuation`);
    // Assert
    expect(response.statusCode).toBe(500);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.payload).not.toContain('private-storage-details');
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
  });
});
