import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { RouterContextProvider } from 'react-router';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

import { ledgerHistory, walletHoldings } from '@/test/ledger-api';
import { walletSummary } from '@/test/wallet-api';

import { walletDetailLoader } from './WalletDetailModule';

vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>();
  return {
    ...original,
    createApiClient: (baseUrl?: string, signal?: AbortSignal) =>
      original.createApiClient(baseUrl ?? 'http://wallet-detail.test/api', signal),
  };
});

const endpoint = `http://wallet-detail.test/api/wallets/${walletSummary.id}`;
const paths = ['', '/holdings', '/transactions'];
const server = setupServer();
let requests: Request[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  requests = [];
  server.use(
    ...paths.map((path) =>
      http.get(endpoint + path, ({ request }) => {
        requests.push(request);
        return responseFor(path);
      }),
    ),
  );
});

function responseFor(path: string) {
  return HttpResponse.json(
    path === '/holdings'
      ? walletHoldings()
      : path === '/transactions'
        ? ledgerHistory
        : walletSummary,
  );
}

function loadDetail({
  walletId = walletSummary.id,
  signal = new AbortController().signal,
  search = '',
} = {}) {
  const request = new Request(`http://web.test/wallets/${walletId}${search}`, { signal });
  return walletDetailLoader({
    request,
    params: { walletId },
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: '/wallets/:walletId',
  });
}

function createGate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  onTestFinished(release);
  return { promise, release };
}

describe('when loading wallet detail', () => {
  it('should start holdings and history while metadata is pending and preserve the requested history page', async () => {
    // Arrange
    const gate = createGate();
    let metadataReturned = false;
    server.use(
      http.get(endpoint, async ({ request }) => {
        requests.push(request);
        await gate.promise;
        metadataReturned = true;
        return HttpResponse.json(walletSummary);
      }),
      http.get(`${endpoint}/transactions`, ({ request }) => {
        requests.push(request);
        return HttpResponse.json({
          ...ledgerHistory,
          pagination: { page: 2, pageSize: 25, totalCount: 26, totalPages: 2 },
        });
      }),
    );
    // Act
    const pending = loadDetail({ search: '?page=2' });
    // Assert
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(metadataReturned).toBe(false);
    expect(requests.map((request) => new URL(request.url).pathname).sort()).toEqual(
      paths.map((path) => `/api/wallets/${walletSummary.id}${path}`).sort(),
    );
    const historyRequest = requests.find((request) => request.url.includes('/transactions'));
    expect(historyRequest && new URL(historyRequest.url).searchParams.get('page')).toBe('2');
    // Act
    gate.release();
    // Assert
    await expect(pending).resolves.toMatchObject({
      wallet: walletSummary,
      summary: walletHoldings(),
      history: { ...ledgerHistory, pagination: { page: 2, totalCount: 26, totalPages: 2 } },
    });
    expect(requests).toHaveLength(3);
  });

  it('should abort all three pending reads and propagate cancellation without returning late data', async () => {
    // Arrange
    const gate = createGate();
    const controller = new AbortController();
    const reason = new DOMException('Navigation cancelled', 'AbortError');
    const fetch = globalThis.fetch;
    const outgoingRequests: Request[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (input instanceof Request) {
        outgoingRequests.push(input);
      }
      return fetch(input, init);
    });
    server.use(
      ...paths.map((path) =>
        http.get(endpoint + path, async ({ request }) => {
          requests.push(request);
          await gate.promise;
          return responseFor(path);
        }),
      ),
    );
    const pending = loadDetail({ signal: controller.signal });
    const cancelled = expect(pending).rejects.toBe(reason);
    await waitFor(() => expect(requests).toHaveLength(3));
    // Act
    controller.abort(reason);
    // Assert
    await cancelled;
    expect(outgoingRequests).toHaveLength(3);
    expect(outgoingRequests.every((request) => request.signal.aborted)).toBe(true);
    gate.release();
  });

  it('should dispatch no reads when navigation is already cancelled', async () => {
    // Arrange
    const controller = new AbortController();
    const reason = new DOMException('Navigation cancelled', 'AbortError');
    controller.abort(reason);
    // Act
    const pending = loadDetail({ signal: controller.signal });
    // Assert
    await expect(pending).rejects.toBe(reason);
    expect(requests).toHaveLength(0);
  });

  it.each(['invalid', ''])(
    'should reject malformed wallet ID %j before any request',
    async (walletId) => {
      // Act
      const pending = loadDetail({ walletId });
      // Assert
      await expect(pending).rejects.toMatchObject({ status: 404 });
      expect(requests).toHaveLength(0);
    },
  );

  it.each(paths.flatMap((path) => [403, 404].map((status) => ({ path, status }))))(
    'should hide missing or inaccessible data from $path with HTTP $status',
    async ({ path, status }) => {
      // Arrange
      server.use(http.get(endpoint + path, () => HttpResponse.json({}, { status })));
      // Act
      const pending = loadDetail();
      // Assert
      await expect(pending).rejects.toMatchObject({ status: 404 });
    },
  );

  it.each(paths)('should redirect an expired session from %j to login', async (path) => {
    // Arrange
    server.use(http.get(endpoint + path, () => HttpResponse.json({}, { status: 401 })));
    // Act
    const failure: unknown = await loadDetail().catch((error: unknown) => error);
    // Assert
    expect(failure).toBeInstanceOf(Response);
    if (failure instanceof Response) {
      expect(failure.status).toBe(302);
      expect(failure.headers.get('Location')).toBe('/login');
    }
  });
});
