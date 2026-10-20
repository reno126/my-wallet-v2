import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { walletSummarySchema } from '@my-wallets/contracts';

import {
  createInstrumentApiFixture,
  type FakeProviderResponse,
  type InstrumentApiFixtureOptions,
} from './instrument-api.js';

export async function createBuyLedgerFixture(
  profileChanges: Record<string, unknown> = {},
  options: InstrumentApiFixtureOptions & { replies?: readonly FakeProviderResponse[] } = {},
) {
  const symbol = `B${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const profile = {
    symbol,
    companyName: 'Verified stock',
    currency: 'USD',
    exchange: 'NASDAQ',
    isEtf: false,
    isFund: false,
    ...profileChanges,
  };
  const fixture = await createInstrumentApiFixture(
    options.replies ?? Array.from({ length: 8 }, () => ({ body: [profile] })),
    options,
  );
  fixture.registeredSymbols.push(symbol);
  const headers = fixture.owner?.headers ?? { origin: 'https://wallet.test.example' };
  const wallet = fixture.owner ? await createWallet(headers) : { id: randomUUID() };
  const url = `/api/wallets/${wallet.id}/transactions`;
  const input = {
    symbol,
    side: 'BUY',
    transactionDate: '2026-10-18',
    quantity: '0.1',
    unitPrice: '190.12345678',
    currency: 'USD',
  };
  return {
    ...fixture,
    symbol,
    headers,
    wallet,
    url,
    input,
    createWallet,
    buy: createTrade,
    sell(changes: Record<string, unknown> = {}, request: TradeRequest = {}) {
      return createTrade({ side: 'SELL', ...changes }, request);
    },
  };

  async function createTrade(changes: Record<string, unknown> = {}, request: TradeRequest = {}) {
    const response = await fixture.server.inject({
      method: 'POST',
      url,
      headers,
      payload: { ...input, ...changes },
      ...request,
    });
    fixture.contract.assertResponse('post', request.url ?? url, response);
    expect(response.headers['cache-control']).toBe('no-store');
    return response;
  }

  async function createWallet(walletHeaders: Record<string, string>) {
    const response = await fixture.server.inject({
      method: 'POST',
      url: '/api/wallets',
      headers: walletHeaders,
      payload: { name: 'Purchase ledger', reportingCurrency: 'USD' },
    });
    fixture.contract.assertResponse('post', '/api/wallets', response);
    expect(response.statusCode).toBe(201);
    return walletSummarySchema.parse(response.json());
  }
}

interface TradeRequest {
  url?: string;
  headers?: Record<string, string>;
}
