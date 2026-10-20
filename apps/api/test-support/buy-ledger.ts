import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { walletSummarySchema } from '@my-wallets/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import { calculatePosition } from '../src/domain/accounting/position.ts';
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
    async deleteTransaction(transactionId: string, request: TradeRequest = {}) {
      const path = request.url ?? `${url}/${transactionId}`;
      const response = await fixture.server.inject({
        method: 'DELETE',
        url: path,
        headers,
        ...request,
      });
      fixture.contract.assertResponse('delete', path, response);
      expect(response.headers['cache-control']).toBe('no-store');
      return response;
    },
    async seedTransaction(overrides: Partial<Prisma.LedgerTransactionCreateManyInput> = {}) {
      const data = {
        walletId: wallet.id,
        symbol,
        side: 'BUY',
        quantity: '1',
        unitPrice: '10',
        currency: 'USD',
        transactionDate: new Date('2026-10-18T00:00:00.000Z'),
        createdAt: new Date('2026-10-19T12:00:00.000Z'),
        ...overrides,
      } satisfies Prisma.LedgerTransactionCreateManyInput;
      if (!fixture.registeredSymbols.includes(data.symbol)) {
        fixture.registeredSymbols.push(data.symbol);
      }
      await fixture.server.prisma.instrument.upsert({
        where: { symbol: data.symbol },
        create: {
          symbol: data.symbol,
          name: 'Verified stock',
          exchange: 'NASDAQ',
          quoteCurrency: 'USD',
        },
        update: {},
      });
      return fixture.server.prisma.ledgerTransaction.create({ data });
    },
    async readPosition(walletId = wallet.id, instrumentSymbol = symbol) {
      const ledger = await fixture.server.prisma.ledgerTransaction.findMany({
        where: { walletId, symbol: instrumentSymbol },
      });
      const result = calculatePosition(
        { walletId, symbol: instrumentSymbol, currency: 'USD' },
        ledger.map((entry) => ({
          ...entry,
          transactionDate: entry.transactionDate.toISOString().slice(0, 10),
          quantity: entry.quantity.toFixed(),
          unitPrice: entry.unitPrice.toFixed(),
        })),
      );
      if (!result.ok) {
        throw new Error(JSON.stringify(result.error));
      }
      return result.value;
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
