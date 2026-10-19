import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { historicalPrice, purchaseInput, stock } from '@/test/purchase-api';
import { walletSummary } from '@/test/wallet-api';

import { createRequestApi } from './createRequestApi';

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

type RequestApi = ReturnType<typeof createRequestApi>;
const operations = [
  { name: 'wallet list', run: (api: RequestApi) => api.wallets.list({ page: 1, pageSize: 25 }) },
  { name: 'wallet read', run: (api: RequestApi) => api.wallets.read(walletSummary.id) },
  { name: 'wallet delete', run: (api: RequestApi) => api.wallets.delete(walletSummary.id) },
  {
    name: 'wallet create',
    run: (api: RequestApi) => api.wallets.create({ name: 'Core', reportingCurrency: 'USD' }),
  },
  {
    name: 'stock search',
    run: (api: RequestApi) => api.purchases.search({ q: 'AAPL', mode: 'symbol' }),
  },
  {
    name: 'historical price',
    run: (api: RequestApi) => api.purchases.price(stock.symbol, historicalPrice.requestedDate),
  },
  {
    name: 'purchase',
    run: (api: RequestApi) => api.purchases.buy(walletSummary.id, purchaseInput),
  },
];

describe('when API calls share a route request signal', () => {
  it('should reject an already cancelled operation before dispatching HTTP', async () => {
    // Arrange
    const controller = new AbortController();
    const reason = { code: 'SUPERSEDED' };
    const api = createRequestApi(controller.signal, endpoint);
    const fetchRequest = vi.spyOn(globalThis, 'fetch');
    controller.abort(reason);
    // Act
    const pending = api.wallets.read(walletSummary.id);
    // Assert
    await expect(pending).rejects.toBe(reason);
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it.each(operations)('should propagate cancellation through $name to HTTP', async ({ run }) => {
    // Arrange
    const controller = new AbortController();
    const api = createRequestApi(controller.signal, endpoint);
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
    const pending = run(api);
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
      const api = createRequestApi(controller.signal, endpoint);
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
      const pending = api.wallets.read(walletSummary.id);
      const rejection = expect(pending).rejects.toBe(reason);
      await started.promise;
      controller.abort(reason);
      release.resolve();
      // Assert
      await rejection;
    },
  );

  it('should keep another request running when one request is cancelled', async () => {
    // Arrange
    const first = new AbortController();
    const second = new AbortController();
    const firstApi = createRequestApi(first.signal, endpoint);
    const secondApi = createRequestApi(second.signal, endpoint);
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
    const firstPending = firstApi.wallets.list({ page: 1, pageSize: 25 });
    const firstRejection = expect(firstPending).rejects.toMatchObject({ name: 'AbortError' });
    const secondPending = secondApi.purchases.search({ q: stock.symbol, mode: 'symbol' });
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
