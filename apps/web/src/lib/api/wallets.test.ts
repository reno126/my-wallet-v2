import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApiClient } from '@/api/client';

import { createWalletApi } from './wallets';

const mockApiServer = setupServer();
const walletsApi = createWalletApi(createApiClient('https://wallet-api.test/api'));

beforeAll(() => mockApiServer.listen());
afterEach(() => mockApiServer.resetHandlers());
afterAll(() => mockApiServer.close());

describe('wallet API client', () => {
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

    await expect(walletsApi.list({ page: 1, pageSize: 25 })).resolves.toStrictEqual({ ok: false });

    mockApiServer.use(
      http.get('https://wallet-api.test/api/wallets', () =>
        HttpResponse.json({ wallets: [], pagination: { page: 1 } }),
      ),
    );

    await expect(walletsApi.list({ page: 1, pageSize: 25 })).resolves.toStrictEqual({ ok: false });
  });
});

function emptyWalletPage(page: number) {
  return {
    wallets: [],
    pagination: { page, pageSize: 25, totalCount: 0, totalPages: 0 },
  };
}

const walletSummary = {
  id: 'b7e967c0-0b21-46f1-8c60-89e19bb2f840',
  name: 'Long-term',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  reportingCurrency: 'USD',
};
