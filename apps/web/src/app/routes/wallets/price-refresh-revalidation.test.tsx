import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { toast } from 'sonner';
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

import { ledgerHistory, ledgerHolding, walletHoldings } from '@/test/ledger-api';
import { priceValuation, providerQuota, refreshStatus } from '@/test/market-data-api';
import { purchaseResult } from '@/test/purchase-api';
import { walletSummary } from '@/test/wallet-api';

import { routeObjects } from '../../router';
import { pricePollIntervalMs } from './_utils/pricePolling';
import { ledgerDictionary } from './ledgerDictionary';
import { pricingDictionary as text, quotaRemaining } from './pricingDictionary';

const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: session, useSession: () => ({ isPending: false }) },
}));
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>();
  return {
    ...original,
    createApiClient: (baseUrl?: string, signal?: AbortSignal) =>
      original.createApiClient(baseUrl ?? 'http://refresh.test/api', signal),
  };
});

const base = 'http://refresh.test/api';
const endpoint = `${base}/wallets/${walletSummary.id}`;
const path = `/wallets/${walletSummary.id}`;
const server = setupServer();
let pageReads = { wallet: 0, holdings: 0, history: 0 };
let priceReads = 0;
let progressReads = 0;
let refreshRequests = 0;
let refreshOutcome: 'pending' | 'fresh' | 'limited' = 'pending';
let valuation = priceValuation();
let status = refreshStatus();
let holding = { ...ledgerHolding };
let history = structuredClone(ledgerHistory);

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  toast.dismiss();
});
beforeEach(() => {
  pageReads = { wallet: 0, holdings: 0, history: 0 };
  priceReads = 0;
  progressReads = 0;
  refreshRequests = 0;
  refreshOutcome = 'pending';
  valuation = priceValuation();
  status = refreshStatus();
  holding = { ...ledgerHolding };
  history = structuredClone(ledgerHistory);
  session.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  server.use(
    http.get(endpoint, () => {
      pageReads.wallet += 1;
      return HttpResponse.json(walletSummary);
    }),
    http.get(`${endpoint}/holdings`, () => {
      pageReads.holdings += 1;
      return HttpResponse.json(walletHoldings([holding]));
    }),
    http.get(`${endpoint}/holdings/AAPL`, () => {
      pageReads.holdings += 1;
      return HttpResponse.json(holding);
    }),
    http.get(`${endpoint}/transactions`, () => {
      pageReads.history += 1;
      return HttpResponse.json(history);
    }),
    http.get(`${endpoint}/price-refresh`, () => {
      progressReads += 1;
      return HttpResponse.json(status);
    }),
    http.get(`${base}/market-data/quota`, () =>
      HttpResponse.json({
        ...providerQuota,
        used: providerQuota.used + refreshRequests,
        remaining: providerQuota.remaining - refreshRequests,
      }),
    ),
    http.post(`${endpoint}/price-refresh`, () => {
      refreshRequests += 1;
      if (refreshOutcome === 'limited') {
        return HttpResponse.json({}, { status: 429 });
      }
      if (refreshOutcome === 'fresh') {
        const freshValuation = priceValuation('fresh');
        valuation = {
          ...freshValuation,
          currentValue: '31',
          holdings: freshValuation.holdings.map((item) => ({ ...item, currentValue: '31' })),
        };
        status = refreshStatus('fresh');
      } else {
        status = {
          ...status,
          hasPendingWork: true,
          holdings: status.holdings.map((item) => ({ ...item, status: 'pending' })),
        };
      }
      return HttpResponse.json(
        { walletId: walletSummary.id, requestedSymbols: ['AAPL'] },
        { status: 202 },
      );
    }),
    http.post(`${endpoint}/transactions`, () => {
      holding = { ...holding, quantity: '1', remainingCostBasis: '10' };
      valuation = {
        ...valuation,
        currentValue: '20',
        holdings: valuation.holdings.map((item) => ({
          ...item,
          quantity: '1',
          currentValue: '20',
        })),
      };
      const transaction = {
        ...purchaseResult().transaction,
        side: 'SELL',
        quantity: '0.5',
        unitPrice: '20',
        transactionDate: '2026-01-18',
      };
      history = {
        ...history,
        transactions: [
          {
            ...transaction,
            side: 'SELL',
            canDelete: true,
            totalAmount: '10',
            realizedProfitLoss: '5',
          },
        ],
        pagination: { ...history.pagination, totalCount: 1 },
      };
      return HttpResponse.json(
        {
          transaction,
          holding: {
            walletId: holding.walletId,
            symbol: holding.symbol,
            quantity: holding.quantity,
            quoteCurrency: holding.quoteCurrency,
          },
        },
        { status: 201 },
      );
    }),
  );
});

async function openPage(suffix: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  onTestFinished(release);
  server.use(
    http.get(`${endpoint}/valuation`, async () => {
      priceReads += 1;
      await gate;
      return HttpResponse.json(valuation);
    }),
  );
  const router = createMemoryRouter(routeObjects, { initialEntries: [path + suffix] });
  onTestFinished(() => router.dispose());
  render(<RouterProvider router={router} />);
  const panel = await screen.findByRole('region', { name: text.title }, { timeout: 10_000 });
  const initialPageReads = { ...pageReads };
  const initialSessionReads = session.mock.calls.length;
  act(() => {
    release();
  });
  const user = userEvent.setup();
  return {
    router,
    user,
    panel,
    initialPageReads,
    initialSessionReads,
    async expectQuotaUpdated() {
      await screen.findByText(
        quotaRemaining(providerQuota.remaining - refreshRequests, providerQuota.limit),
      );
      await waitFor(() =>
        expect(within(panel).getByRole('button', { name: text.retry })).toBeEnabled(),
      );
    },
    async requestRefresh() {
      const previousRequests = refreshRequests;
      await user.click(within(panel).getByRole('button', { name: text.refresh }));
      await waitFor(() => expect(refreshRequests).toBe(previousRequests + 1));
    },
    async sell() {
      await user.click(screen.getByRole('button', { name: ledgerDictionary.sell.open('AAPL') }));
      await user.type(screen.getByRole('textbox', { name: ledgerDictionary.sell.quantity }), '0.5');
      await user.type(screen.getByRole('textbox', { name: ledgerDictionary.sell.price }), '20');
      await user.click(screen.getByRole('button', { name: ledgerDictionary.sell.submit }));
    },
  };
}

describe('when scheduling price refreshes without reloading the ledger', () => {
  it('should reload valuation after a sale even when the last background read checked only progress', async () => {
    // Arrange
    const schedule = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (handler, timeout, ...arguments_: unknown[]) =>
        schedule(handler, timeout === pricePollIntervalMs ? 50 : timeout, ...arguments_),
    );
    const page = await openPage('');
    await within(page.panel).findByText(text.pending);
    await waitFor(() => expect(progressReads).toBeGreaterThanOrEqual(3));
    // Act
    await page.sell();
    // Assert
    await within(page.panel).findByText('USD 20.00', {}, { timeout: 5_000 });
    expect(pageReads).toEqual({ wallet: 2, holdings: 2, history: 2 });
  });

  it('should redirect an expired session reported by the refresh action', async () => {
    // Arrange
    server.use(
      http.post(`${endpoint}/price-refresh`, () => {
        session.mockResolvedValue({ data: null, error: null });
        return HttpResponse.json({}, { status: 401 });
      }),
    );
    // Act
    const page = await openPage('');
    // Assert
    await waitFor(() => expect(page.router.state.location.pathname).toBe('/login'));
  });

  it.each(['', '/instruments/AAPL'])(
    'should update automatic and manual refresh results and still revalidate a later sale on %s',
    async (suffix) => {
      // Arrange
      const page = await openPage(suffix);
      // Assert
      await within(page.panel).findByText(text.pending);
      await page.expectQuotaUpdated();
      expect(refreshRequests).toBe(1);
      expect(priceReads).toBe(2);
      expect(pageReads).toEqual(page.initialPageReads);
      expect(session).toHaveBeenCalledTimes(page.initialSessionReads);
      // Act
      refreshOutcome = 'fresh';
      await page.requestRefresh();
      // Assert
      await within(page.panel).findByText('USD 31.00');
      expect(within(page.panel).getByText(text.freshness.fresh)).toBeVisible();
      await page.expectQuotaUpdated();
      expect(refreshRequests).toBe(2);
      expect(priceReads).toBe(3);
      expect(pageReads).toEqual(page.initialPageReads);
      expect(session).toHaveBeenCalledTimes(page.initialSessionReads);
      // Act
      await page.sell();
      // Assert
      await screen.findByRole('article', { name: 'SELL AAPL 2026-01-18' }, { timeout: 5_000 });
      expect(pageReads).toEqual({ wallet: 2, holdings: 2, history: 2 });
      expect(session).toHaveBeenCalledTimes(page.initialSessionReads + 1);
    },
  );

  it.each(['', '/instruments/AAPL'])(
    'should update quota and retain failure feedback without revalidating the page after automatic and manual rejection on %s',
    async (suffix) => {
      // Arrange
      refreshOutcome = 'limited';
      const page = await openPage(suffix);
      // Assert
      await within(page.panel).findByText(text.limited);
      await page.expectQuotaUpdated();
      expect(refreshRequests).toBe(1);
      expect(priceReads).toBe(2);
      expect(pageReads).toEqual(page.initialPageReads);
      expect(session).toHaveBeenCalledTimes(page.initialSessionReads);
      // Act
      await page.requestRefresh();
      // Assert
      await page.expectQuotaUpdated();
      expect(within(page.panel).getByText(text.limited)).toBeVisible();
      expect(within(page.panel).getByText('USD 30.00')).toBeVisible();
      expect(refreshRequests).toBe(2);
      expect(priceReads).toBe(3);
      expect(pageReads).toEqual(page.initialPageReads);
      expect(session).toHaveBeenCalledTimes(page.initialSessionReads);
    },
  );
});
