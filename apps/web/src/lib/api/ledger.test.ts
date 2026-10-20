import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ledgerHistory, ledgerHolding, walletHoldings } from '@/test/ledger-api';

import { createRequestClient } from './createRequestClient';
import { createLedgerApi } from './ledger';
import { createTransactionsApi } from './transactions';

const base = 'https://ledger-api.test/api';
const walletId = ledgerHolding.walletId;
const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('when crossing the ledger HTTP boundary', () => {
  it('should validate summaries and encode symbol and pagination filters', async () => {
    // Arrange
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${base}/wallets/:walletId/holdings`, () => HttpResponse.json(walletHoldings())),
      http.get(`${base}/wallets/:walletId/holdings/:symbol`, () =>
        HttpResponse.json(ledgerHolding),
      ),
      http.get(`${base}/wallets/:walletId/transactions`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(ledgerHistory);
      }),
    );
    const api = createLedgerApi(createRequestClient(new AbortController().signal, base));
    // Act
    const summary = await api.holdings(walletId);
    const holding = await api.holding(walletId, 'AAPL');
    const history = await api.history(walletId, { page: 2, pageSize: 25, symbol: 'AAPL' });
    // Assert
    expect(summary).toEqual({ ok: true, value: walletHoldings() });
    expect(holding).toEqual({ ok: true, value: ledgerHolding });
    expect(history).toEqual({ ok: true, value: ledgerHistory });
    expect(query?.get('symbol')).toBe('AAPL');
    expect(query?.get('page')).toBe('2');
  });

  it('should reject malformed financial summaries at the response boundary', async () => {
    // Arrange
    server.use(
      http.get(`${base}/wallets/:walletId/holdings`, () =>
        HttpResponse.json({ ...walletHoldings(), remainingCostBasis: 15 }),
      ),
    );
    const api = createLedgerApi(createRequestClient(new AbortController().signal, base));
    // Act
    const result = await api.holdings(walletId);
    // Assert
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-response' } });
  });

  it('should preserve exact sale input and require an empty 204 deletion receipt', async () => {
    // Arrange
    let body: unknown;
    const first = ledgerHistory.transactions[0];
    if (!first) {
      throw new Error('Missing sale fixture.');
    }
    server.use(
      http.post(`${base}/wallets/:walletId/transactions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            transaction: first,
            holding: { walletId, symbol: 'AAPL', quantity: '1.5', quoteCurrency: 'USD' },
          },
          { status: 201 },
        );
      }),
      http.delete(
        `${base}/wallets/:walletId/transactions/:id`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const api = createTransactionsApi(createRequestClient(new AbortController().signal, base));
    const input = {
      symbol: 'AAPL',
      side: 'SELL',
      quantity: '0.00000001',
      unitPrice: '123.12345678',
      transactionDate: '2026-01-19',
      currency: 'USD',
    } satisfies Parameters<typeof api.sell>[1];
    // Act
    const sold = await api.sell(walletId, input);
    const deleted = await api.delete(walletId, first.id);
    // Assert
    expect(body).toEqual(input);
    expect(sold.ok).toBe(true);
    expect(deleted).toEqual({ ok: true, value: undefined });
  });

  it('should propagate cancellation before reads or mutations dispatch', async () => {
    // Arrange
    const abort = new AbortController();
    const client = createRequestClient(abort.signal, base);
    const fetch = vi.spyOn(globalThis, 'fetch');
    abort.abort();
    // Assert
    await expect(createLedgerApi(client).holdings(walletId)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(createTransactionsApi(client).delete(walletId, walletId)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
