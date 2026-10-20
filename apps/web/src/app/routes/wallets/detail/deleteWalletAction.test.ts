import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { RouterContextProvider } from 'react-router';
import { toast } from 'sonner';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createRequestClient } from '@/lib/api/createRequestClient';
import * as walletApiModule from '@/lib/api/wallets';
import { walletSummary } from '@/test/wallet-api';

import { deleteWalletAction } from './deleteWalletAction';

const endpoint = 'https://wallet-api.test/api';
const mockApiServer = setupServer();
beforeAll(() => mockApiServer.listen());
afterAll(() => mockApiServer.close());
afterEach(() => {
  mockApiServer.resetHandlers();
  vi.restoreAllMocks();
});

describe('when wallet deletion is cancelled between API calls', () => {
  it('should stop before DELETE and avoid success feedback after reading the current name', async () => {
    // Arrange
    const controller = new AbortController();
    const reason = { code: 'NAVIGATED_AWAY' };
    const request = new Request(`https://web.test/wallets/${walletSummary.id}`, {
      method: 'DELETE',
      signal: controller.signal,
      body: JSON.stringify({ confirmationName: walletSummary.name }),
    });
    const wallets = walletApiModule.createWalletApi(createRequestClient(request.signal, endpoint));
    vi.spyOn(walletApiModule, 'createWalletApi').mockReturnValue(wallets);
    const readWallet = wallets.read.bind(wallets);
    vi.spyOn(wallets, 'read').mockImplementation(async (walletId) => {
      const result = await readWallet(walletId);
      controller.abort(reason);
      return result;
    });
    const successToast = vi.spyOn(toast, 'success');
    let reads = 0;
    let deletes = 0;
    mockApiServer.use(
      http.get(`${endpoint}/wallets/${walletSummary.id}`, () => {
        reads += 1;
        return HttpResponse.json(walletSummary);
      }),
      http.delete(`${endpoint}/wallets/${walletSummary.id}`, () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    // Act
    const pending = deleteWalletAction({
      request,
      params: { walletId: walletSummary.id },
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: '/wallets/:walletId',
    });
    // Assert
    await expect(pending).rejects.toBe(reason);
    expect(reads).toBe(1);
    expect(deletes).toBe(0);
    expect(successToast).not.toHaveBeenCalled();
  });
});
