import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@/api/client';
import { walletSummary } from '@/test/wallet-api';

import { createWalletApi } from './wallets';

const mockApiServer = setupServer();
const walletsApi = createWalletApi(createApiClient('https://wallet-api.test/api'));

beforeAll(() => mockApiServer.listen());
afterEach(() => {
  mockApiServer.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => mockApiServer.close());

describe('wallet API client', () => {
  it('should delete only the selected wallet with credentials and accept an empty 204 response', async () => {
    // Arrange
    const fetchRequest = vi.spyOn(globalThis, 'fetch');
    let deleteRequest: Request | undefined;
    mockApiServer.use(
      http.delete(`https://wallet-api.test/api/wallets/${walletSummary.id}`, ({ request }) => {
        deleteRequest = request;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    // Act
    const result = await walletsApi.delete(walletSummary.id);
    // Assert
    expect(result).toStrictEqual({ ok: true, value: undefined });
    expect(fetchRequest.mock.calls[0]?.[0]).toMatchObject({
      credentials: 'include',
      method: 'DELETE',
    });
    expect(await deleteRequest?.text()).toBe('');
  });

  it.each([200, 202])(
    'should reject an unexpected deletion success status of %s',
    async (status) => {
      // Arrange
      mockApiServer.use(
        http.delete(
          `https://wallet-api.test/api/wallets/${walletSummary.id}`,
          () => new HttpResponse(null, { status }),
        ),
      );
      // Act
      const result = await walletsApi.delete(walletSummary.id);
      // Assert
      expect(result).toStrictEqual({ ok: false, error: { kind: 'invalid-response' } });
    },
  );

  it('loads a page of wallets through the typed endpoint', async () => {
    let requestedUrl = '';
    mockApiServer.use(
      http.get('https://wallet-api.test/api/wallets', ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(emptyWalletPage(2));
      }),
    );

    const result = await walletsApi.list({ page: 2, pageSize: 25 });

    expect(new URL(requestedUrl).searchParams.get('page')).toBe('2');
    expect(result).toMatchObject({
      ok: true,
      value: { pagination: { page: 2, pageSize: 25 } },
    });
  });

  it('posts a wallet and validates the lifecycle response', async () => {
    let requestBody: unknown;
    mockApiServer.use(
      http.post('https://wallet-api.test/api/wallets', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json(walletSummary, { status: 201 });
      }),
    );

    const result = await walletsApi.create({ name: 'Long-term', reportingCurrency: 'USD' });

    expect(requestBody).toStrictEqual({ name: 'Long-term', reportingCurrency: 'USD' });
    expect(result).toMatchObject({ ok: true, value: { id: walletSummary.id } });
  });

  it('returns a safe failure for API errors and invalid response data', async () => {
    mockApiServer.use(
      http.get('https://wallet-api.test/api/wallets', () =>
        HttpResponse.json({ message: 'Private server detail' }, { status: 500 }),
      ),
    );

    await expect(walletsApi.list({ page: 1, pageSize: 25 })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'http', status: 500 },
    });

    mockApiServer.use(
      http.get('https://wallet-api.test/api/wallets', () =>
        HttpResponse.json({ wallets: [], pagination: { page: 1 } }),
      ),
    );

    await expect(walletsApi.list({ page: 1, pageSize: 25 })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid-response' },
    });
  });

  it('should preserve an authentication failure for the route without redirecting in the adapter', async () => {
    // Arrange
    mockApiServer.use(
      http.post('https://wallet-api.test/api/wallets', () =>
        HttpResponse.json(
          {
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Private detail',
              requestId: walletSummary.id,
            },
          },
          { status: 401 },
        ),
      ),
    );
    // Act
    const result = await walletsApi.create({ name: 'Core', reportingCurrency: 'USD' });
    // Assert
    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'http', status: 401, code: 'UNAUTHENTICATED' },
    });
  });

  it('should preserve rate limit retry metadata without exposing server messages', async () => {
    // Arrange
    mockApiServer.use(
      http.get('https://wallet-api.test/api/wallets', () =>
        HttpResponse.json(
          { message: 'Private detail' },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      ),
    );
    // Act
    const result = await walletsApi.list({ page: 1, pageSize: 25 });
    // Assert
    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'http', status: 429, retryAfterSeconds: 30 },
    });
  });

  it.each([
    { scenario: 'future date', header: 'Sat, 17 Oct 2026 12:00:30 GMT', seconds: 30 },
    { scenario: 'expired date', header: 'Sat, 17 Oct 2026 11:59:30 GMT', seconds: 0 },
    { scenario: 'invalid date', header: 'not-a-date', seconds: undefined },
    { scenario: 'empty value', header: '', seconds: undefined },
    { scenario: 'negative value', header: '-1', seconds: undefined },
    { scenario: 'fractional value', header: '1.5', seconds: undefined },
    { scenario: 'numeric overflow', header: '9'.repeat(400), seconds: undefined },
  ])('should normalize Retry-After for $scenario', async ({ header, seconds }) => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-17T12:00:00.250Z'));
    mockApiServer.use(
      http.get('https://wallet-api.test/api/wallets', () =>
        HttpResponse.json({}, { status: 429, headers: { 'Retry-After': header } }),
      ),
    );
    // Act
    const result = await walletsApi.list({ page: 1, pageSize: 25 });
    // Assert
    expect(result).toStrictEqual({
      ok: false,
      error: {
        kind: 'http',
        status: 429,
        ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
      },
    });
  });

  it('should classify syntactically malformed response JSON as an invalid response', async () => {
    // Arrange
    mockApiServer.use(
      http.post(
        'https://wallet-api.test/api/wallets',
        () =>
          new HttpResponse('{', { status: 201, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    // Act
    const result = await walletsApi.create({ name: 'Core', reportingCurrency: 'USD' });
    // Assert
    expect(result).toStrictEqual({ ok: false, error: { kind: 'invalid-response' } });
  });

  it('should load and validate a wallet detail response', async () => {
    // Arrange
    mockApiServer.use(
      http.get(`https://wallet-api.test/api/wallets/${walletSummary.id}`, () =>
        HttpResponse.json(walletSummary),
      ),
    );
    // Act
    const result = await walletsApi.read(walletSummary.id);
    // Assert
    expect(result).toStrictEqual({ ok: true, value: walletSummary });
  });

  it('should keep transport failures safe', async () => {
    // Arrange
    mockApiServer.use(http.get('https://wallet-api.test/api/wallets', () => HttpResponse.error()));
    // Assert
    await expect(walletsApi.list({ page: 1, pageSize: 25 })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'network' },
    });
  });

  it.each(['list', 'create'] as const)(
    'should propagate cancellation for %s instead of returning an error result',
    async (operation) => {
      // Arrange
      const controller = new AbortController();
      let resolveStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      mockApiServer.use(
        http.all('https://wallet-api.test/api/wallets', async ({ request }) => {
          resolveStarted();
          await new Promise<void>((resolve) =>
            request.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          return HttpResponse.json(emptyWalletPage(1));
        }),
      );
      const pending =
        operation === 'list'
          ? walletsApi.list({ page: 1, pageSize: 25 }, controller.signal)
          : walletsApi.create({ name: 'Core', reportingCurrency: 'USD' }, controller.signal);
      const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      // Act
      await started;
      controller.abort();
      // Assert
      await rejection;
    },
  );
});

function emptyWalletPage(page: number) {
  return {
    wallets: [],
    pagination: { page, pageSize: 25, totalCount: 0, totalPages: 0 },
  };
}
