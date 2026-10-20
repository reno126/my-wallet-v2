import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { historicalPrice, purchaseInput, stock } from '@/test/purchase-api';
import { walletSummary } from '@/test/wallet-api';

import { createRequestClient, type RequestClient } from './createRequestClient';
import { createPurchasesApi } from './purchases';
import { createWalletApi } from './wallets';

const endpoint = 'https://wallet-api.test/api';
const mockApiServer = setupServer();
beforeAll(() => mockApiServer.listen());
afterAll(() => mockApiServer.close());
afterEach(() => {
  mockApiServer.resetHandlers();
  vi.restoreAllMocks();
});

function createGate() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const operations = [
  {
    name: 'wallet list',
    run: (client: RequestClient) => createWalletApi(client).list({ page: 1, pageSize: 25 }),
  },
  {
    name: 'wallet read',
    run: (client: RequestClient) => createWalletApi(client).read(walletSummary.id),
  },
  {
    name: 'wallet delete',
    run: (client: RequestClient) => createWalletApi(client).delete(walletSummary.id),
  },
  {
    name: 'wallet create',
    run: (client: RequestClient) =>
      createWalletApi(client).create({ name: 'Core', reportingCurrency: 'USD' }),
  },
  {
    name: 'stock search',
    run: (client: RequestClient) =>
      createPurchasesApi(client).search({ q: 'AAPL', mode: 'symbol' }),
  },
  {
    name: 'historical price',
    run: (client: RequestClient) =>
      createPurchasesApi(client).price(stock.symbol, historicalPrice.requestedDate),
  },
  {
    name: 'purchase',
    run: (client: RequestClient) => createPurchasesApi(client).buy(walletSummary.id, purchaseInput),
  },
];

describe('when API calls share a route request signal', () => {
  it('should reject an already cancelled operation before dispatching HTTP', async () => {
    // Arrange
    const controller = new AbortController();
    const reason = { code: 'SUPERSEDED' };
    const wallets = createWalletApi(createRequestClient(controller.signal, endpoint));
    const fetchRequest = vi.spyOn(globalThis, 'fetch');
    controller.abort(reason);
    // Act
    const pending = wallets.read(walletSummary.id);
    // Assert
    await expect(pending).rejects.toBe(reason);
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it.each(operations)('should propagate cancellation through $name to HTTP', async ({ run }) => {
    // Arrange
    const controller = new AbortController();
    const client = createRequestClient(controller.signal, endpoint);
    const started = createGate();
    let outgoingSignal: AbortSignal | undefined;
    mockApiServer.use(
      http.all(`${endpoint}/*`, async ({ request }) => {
        outgoingSignal = request.signal;
        started.resolve();
        await new Promise<void>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return HttpResponse.json({});
      }),
    );
    // Act
    const pending = run(client);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;
    controller.abort();
    // Assert
    await rejection;
    expect(outgoingSignal).toMatchObject({ aborted: true });
  });

  it.each(['success', 'failure'])(
    'should preserve the cancellation reason when transport reports a late %s',
    async (outcome) => {
      // Arrange
      const controller = new AbortController();
      const reason = { code: 'SUPERSEDED' };
      const wallets = createWalletApi(createRequestClient(controller.signal, endpoint));
      const started = createGate();
      const release = createGate();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        started.resolve();
        await release.promise;
        if (outcome === 'failure') {
          throw new TypeError('Late transport failure');
        }
        return Response.json(walletSummary);
      });
      // Act
      const pending = wallets.read(walletSummary.id);
      const rejection = expect(pending).rejects.toBe(reason);
      await started.promise;
      controller.abort(reason);
      release.resolve();
      // Assert
      await rejection;
    },
  );

  it('should cancel both domain APIs composed with the same request client', async () => {
    // Arrange
    const controller = new AbortController();
    const reason = { code: 'NAVIGATED_AWAY' };
    const client = createRequestClient(controller.signal, endpoint);
    const wallets = createWalletApi(client);
    const purchases = createPurchasesApi(client);
    const started = createGate();
    const outgoingSignals: AbortSignal[] = [];
    mockApiServer.use(
      http.all(`${endpoint}/*`, async ({ request }) => {
        outgoingSignals.push(request.signal);
        if (outgoingSignals.length === 2) {
          started.resolve();
        }
        await new Promise<void>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return HttpResponse.json({});
      }),
    );
    // Act
    const walletPending = wallets.list({ page: 1, pageSize: 25 });
    const purchasePending = purchases.search({ q: stock.symbol, mode: 'symbol' });
    const rejections = Promise.all([
      expect(walletPending).rejects.toBe(reason),
      expect(purchasePending).rejects.toBe(reason),
    ]);
    await started.promise;
    controller.abort(reason);
    // Assert
    await rejections;
    expect(outgoingSignals).toHaveLength(2);
    for (const signal of outgoingSignals) {
      expect(signal.aborted).toBe(true);
    }
  });

  it('should keep another request running when one request is cancelled', async () => {
    // Arrange
    const first = new AbortController();
    const second = new AbortController();
    const wallets = createWalletApi(createRequestClient(first.signal, endpoint));
    const purchases = createPurchasesApi(createRequestClient(second.signal, endpoint));
    const firstStarted = createGate();
    const secondStarted = createGate();
    const releaseSearch = createGate();
    let searchSignal: AbortSignal | undefined;
    mockApiServer.use(
      http.get(`${endpoint}/wallets`, async ({ request }) => {
        firstStarted.resolve();
        await new Promise<void>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return HttpResponse.json({});
      }),
      http.get(`${endpoint}/instruments/search`, async ({ request }) => {
        searchSignal = request.signal;
        secondStarted.resolve();
        await releaseSearch.promise;
        return HttpResponse.json({ results: [stock], excluded: [] });
      }),
    );
    // Act
    const firstPending = wallets.list({ page: 1, pageSize: 25 });
    const firstRejection = expect(firstPending).rejects.toMatchObject({ name: 'AbortError' });
    const secondPending = purchases.search({ q: stock.symbol, mode: 'symbol' });
    await Promise.all([firstStarted.promise, secondStarted.promise]);
    first.abort();
    // Assert
    await firstRejection;
    expect(searchSignal).toMatchObject({ aborted: false });
    // Act
    releaseSearch.resolve();
    // Assert
    await expect(secondPending).resolves.toMatchObject({
      ok: true,
      value: { results: [stock], excluded: [] },
    });
  });
});
