import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { historicalPrice, purchaseInput, purchaseResult, stock } from '@/test/purchase-api';
import { walletSummary } from '@/test/wallet-api';

import { createRequestClient } from './createRequestClient';
import { createPurchasesApi } from './purchases';

const endpoint = 'https://wallet-api.test/api';
const mockApiServer = setupServer();
const purchases = createPurchasesApi(createRequestClient(new AbortController().signal, endpoint));
beforeAll(() => mockApiServer.listen());
afterEach(() => {
  mockApiServer.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => mockApiServer.close());

describe('when crossing the purchase API boundary', () => {
  it('should send the selected symbol, date and currency for price lookup', async () => {
    // Arrange
    let requestedUrl: URL | undefined;
    mockApiServer.use(
      http.get(`${endpoint}/instruments/:symbol/price`, ({ request }) => {
        requestedUrl = new URL(request.url);
        return HttpResponse.json(historicalPrice);
      }),
    );
    // Act
    const result = await purchases.price(
      stock.symbol,
      historicalPrice.requestedDate,
      stock.quoteCurrency,
    );
    // Assert
    expect(result.ok).toBe(true);
    expect(requestedUrl?.pathname).toBe(`/api/instruments/${stock.symbol}/price`);
    expect(requestedUrl?.searchParams.get('date')).toBe(historicalPrice.requestedDate);
    expect(requestedUrl?.searchParams.get('currency')).toBe(stock.quoteCurrency);
  });

  it('should encode company queries and include session credentials', async () => {
    // Arrange
    let search: URL | undefined;
    const fetchRequest = vi.spyOn(globalThis, 'fetch');
    mockApiServer.use(
      http.get(`${endpoint}/instruments/search`, ({ request }) => {
        search = new URL(request.url);
        return HttpResponse.json({ results: [stock], excluded: [] });
      }),
    );
    // Act
    const result = await purchases.search({ q: 'A & B', mode: 'name' });
    // Assert
    expect(result).toMatchObject({ ok: true, value: { results: [stock] } });
    expect(search?.searchParams.get('q')).toBe('A & B');
    expect(search?.searchParams.get('mode')).toBe('name');
    expect(fetchRequest.mock.calls[0]?.[0]).toMatchObject({ credentials: 'include' });
  });

  it.each([
    { ...historicalPrice, currency: 'EUR' },
    { ...historicalPrice, unitPrice: 230.1 },
    { ...historicalPrice, unitPrice: '1.123456789' },
  ])('should reject unsupported quote data: %j', async (body) => {
    // Arrange
    mockApiServer.use(
      http.get(`${endpoint}/instruments/:symbol/price`, () => HttpResponse.json(body)),
    );
    // Act
    const result = await purchases.price(
      stock.symbol,
      historicalPrice.requestedDate,
      stock.quoteCurrency,
    );
    // Assert
    expect(result).toStrictEqual({ ok: false, error: { kind: 'invalid-response' } });
  });

  it('should preserve decimal strings in the submitted purchase and validate the receipt', async () => {
    // Arrange
    let body: unknown;
    let path: string | undefined;
    mockApiServer.use(
      http.post(`${endpoint}/wallets/:walletId/transactions`, async ({ request }) => {
        body = await request.json();
        path = new URL(request.url).pathname;
        return HttpResponse.json(purchaseResult(), { status: 201 });
      }),
    );
    // Act
    const result = await purchases.buy(walletSummary.id, purchaseInput);
    // Assert
    expect(body).toStrictEqual(purchaseInput);
    expect(path).toBe(`/api/wallets/${walletSummary.id}/transactions`);
    expect(result).toMatchObject({ ok: true, value: purchaseResult() });
  });

  it.each([200, 202])('should treat a status %s receipt as unconfirmed', async (status) => {
    // Arrange
    mockApiServer.use(
      http.post(`${endpoint}/wallets/:walletId/transactions`, () =>
        HttpResponse.json(purchaseResult(), { status }),
      ),
    );
    // Act
    const result = await purchases.buy(walletSummary.id, purchaseInput);
    // Assert
    expect(result).toStrictEqual({ ok: false, error: { kind: 'invalid-response' } });
  });
});
