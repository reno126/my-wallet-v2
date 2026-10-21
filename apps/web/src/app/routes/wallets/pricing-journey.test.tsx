import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterProvider } from 'react-router';
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
import { priceValuation, providerQuota, refreshStatus } from '@/test/market-data-api';
import { walletSummary } from '@/test/wallet-api';

import { routeObjects } from '../../router';
import { pricePollIntervalMs, pricePollLimit } from './_hooks/useWalletPricing';
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
      original.createApiClient(baseUrl ?? 'http://pricing.test/api', signal),
  };
});
const base = 'http://pricing.test/api';
const endpoint = `${base}/wallets/${walletSummary.id}`;
const path = `/wallets/${walletSummary.id}`;
const server = setupServer();
let valuation = priceValuation();
let status = refreshStatus();
let quota = { ...providerQuota };
let requests = 0;
let reads = 0;
beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
beforeEach(() => {
  valuation = priceValuation();
  status = refreshStatus();
  quota = { ...providerQuota };
  requests = 0;
  reads = 0;
  session.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  server.use(
    http.get(endpoint, () => HttpResponse.json(walletSummary)),
    http.get(`${endpoint}/holdings`, () => HttpResponse.json(walletHoldings())),
    http.get(`${endpoint}/holdings/AAPL`, () => HttpResponse.json(walletHoldings().holdings[0])),
    http.get(`${endpoint}/transactions`, () => HttpResponse.json(ledgerHistory)),
    http.get(`${endpoint}/valuation`, () => {
      reads += 1;
      return HttpResponse.json(valuation);
    }),
    http.get(`${endpoint}/price-refresh`, () => HttpResponse.json(status)),
    http.get(`${base}/market-data/quota`, () => HttpResponse.json(quota)),
    http.post(`${endpoint}/price-refresh`, () => {
      requests += 1;
      status = {
        ...status,
        hasPendingWork: true,
        holdings: status.holdings.map((holding) => ({ ...holding, status: 'pending' })),
      };
      return HttpResponse.json(
        { walletId: walletSummary.id, requestedSymbols: ['AAPL'] },
        { status: 202 },
      );
    }),
  );
});

function openPage(suffix = '') {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path + suffix] });
  onTestFinished(() => router.dispose());
  render(<RouterProvider router={router} />);
  return {
    router,
    user: userEvent.setup(),
    panel: () => screen.getByRole('region', { name: text.title }),
  };
}

function acceleratePricePolling() {
  const schedule = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout) =>
    schedule(handler, timeout === pricePollIntervalMs ? 10 : timeout),
  );
}

describe('when showing cached valuations and refresh progress', () => {
  it('should reconcile a valuation read that finishes before the status reports fresh prices without another refresh request', async () => {
    // Arrange
    acceleratePricePolling();
    status = refreshStatus('fresh');
    server.use(
      http.get(`${endpoint}/valuation`, () => {
        reads += 1;
        return HttpResponse.json(priceValuation(reads === 1 ? 'stale' : 'fresh'));
      }),
    );
    openPage();
    // Assert
    expect(
      await within(await screen.findByRole('region', { name: text.title })).findByText(
        text.freshness.fresh,
      ),
    ).toBeVisible();
    expect(requests).toBe(0);
    expect(reads).toBe(2);
  });

  it('should confirm exhausted pending work once so a concurrent claim can still finish its final-unit quote', async () => {
    // Arrange
    acceleratePricePolling();
    quota = { ...quota, exhausted: true, used: 250, remaining: 0 };
    let statusReads = 0;
    server.use(
      http.get(`${endpoint}/price-refresh`, () => {
        statusReads += 1;
        if (statusReads === 3) {
          valuation = priceValuation('fresh');
        }
        return HttpResponse.json({
          ...refreshStatus(statusReads >= 3 ? 'fresh' : 'stale'),
          hasPendingWork: statusReads < 3,
          holdings: [
            {
              symbol: 'AAPL',
              freshness: statusReads >= 3 ? 'fresh' : 'stale',
              status: statusReads === 1 ? 'pending' : statusReads === 2 ? 'running' : 'succeeded',
              nextAttemptAt: null,
              lastFailureCode: null,
            },
          ],
        });
      }),
    );
    openPage();
    // Assert
    expect(
      await within(await screen.findByRole('region', { name: text.title })).findByText(
        text.freshness.fresh,
      ),
    ).toBeVisible();
    expect(requests).toBe(0);
    expect(statusReads).toBeGreaterThanOrEqual(3);
  });

  it('should retain stale values after provider failure and honor a rate-limited refresh without automatic resubmission', async () => {
    // Arrange
    status = {
      ...status,
      holdings: status.holdings.map((holding) => ({
        ...holding,
        status: 'failed',
        lastFailureCode: 'PROVIDER_UNAVAILABLE',
      })),
    };
    server.use(
      http.post(`${endpoint}/price-refresh`, () => {
        requests += 1;
        return HttpResponse.json(
          { error: { code: 'RATE_LIMITED', message: 'Limited', requestId: walletSummary.id } },
          { status: 429, headers: { 'retry-after': '30' } },
        );
      }),
    );
    const page = openPage();
    // Assert
    expect(
      await within(await screen.findByRole('region', { name: text.title })).findByText(
        text.limited,
      ),
    ).toBeVisible();
    expect(within(page.panel()).getByText('USD 30.00')).toBeVisible();
    expect(requests).toBe(1);
    // Act
    await waitFor(() =>
      expect(within(page.panel()).getByRole('button', { name: text.retry })).toBeEnabled(),
    );
    await page.user.click(within(page.panel()).getByRole('button', { name: text.retry }));
    // Assert
    expect(await within(page.panel()).findByText(text.failed)).toBeVisible();
    expect(requests).toBe(1);
  });

  it('should remove an active polling timer when navigating away', async () => {
    // Arrange
    acceleratePricePolling();
    const page = openPage();
    await within(await screen.findByRole('region', { name: text.title })).findByText(text.pending);
    // Act
    await act(async () => {
      await page.router.navigate('/wallets/new');
    });
    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    });
    const stoppedAt = reads;
    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    });
    // Assert
    expect(reads).toBe(stoppedAt);
  });

  it('should not display the previous wallet valuation when navigating to another wallet with unavailable pricing', async () => {
    // Arrange
    valuation = priceValuation('fresh');
    status = refreshStatus('fresh');
    const page = openPage();
    await within(await screen.findByRole('region', { name: text.title })).findByText('USD 30.00');
    const otherId = 'b7e967c0-0b21-46f1-8c60-89e19bb2f841';
    const otherEndpoint = `${base}/wallets/${otherId}`;
    server.use(
      http.get(otherEndpoint, () =>
        HttpResponse.json({ ...walletSummary, id: otherId, name: 'Another wallet' }),
      ),
      http.get(`${otherEndpoint}/holdings`, () => HttpResponse.json(walletHoldings([], otherId))),
      http.get(`${otherEndpoint}/transactions`, () =>
        HttpResponse.json({ ...ledgerHistory, transactions: [] }),
      ),
      http.get(`${otherEndpoint}/valuation`, () => HttpResponse.json({}, { status: 503 })),
      http.get(`${otherEndpoint}/price-refresh`, () => HttpResponse.json({}, { status: 503 })),
    );
    // Act
    await act(async () => {
      await page.router.navigate(`/wallets/${otherId}`);
    });
    // Assert
    expect(await within(page.panel()).findByText(text.unavailable)).toBeVisible();
    expect(within(page.panel()).queryByText('USD 30.00')).not.toBeInTheDocument();
    expect(requests).toBe(0);
  });

  it('should render the ledger before pricing responds and refresh stale prices without hiding cached values', async () => {
    // Arrange
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    acceleratePricePolling();
    server.use(
      http.get(`${endpoint}/valuation`, async () => {
        await gate;
        return HttpResponse.json(valuation);
      }),
    );
    const page = openPage();
    // Assert
    expect(
      await screen.findByRole('heading', { name: walletSummary.name }, { timeout: 10_000 }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: ledgerDictionary.walletSummary })).toBeVisible();
    expect(requests).toBe(0);
    // Act
    act(() => {
      release();
    });
    await waitFor(() => expect(requests).toBe(1));
    // Assert
    expect(await within(page.panel()).findByText('USD 30.00')).toBeVisible();
    expect(await within(page.panel()).findByText(text.pending)).toBeVisible();
    // Act
    valuation = { ...priceValuation('fresh'), currentValue: '9007199254740993.125' };
    status = refreshStatus('fresh');
    // Assert
    expect(await within(page.panel()).findByText('USD 9,007,199,254,740,993.13')).toBeVisible();
    expect(within(page.panel()).getByText(text.freshness.fresh)).toBeVisible();
    expect(requests).toBe(1);
  });

  it.each(['fresh', 'not_required'] as const)(
    'should not request provider work for %s positions',
    async (freshness) => {
      // Arrange
      valuation = priceValuation(freshness);
      status = refreshStatus(freshness);
      const page = openPage();
      // Assert
      expect(
        await within(await screen.findByRole('region', { name: text.title })).findByText(
          text.freshness[freshness],
        ),
      ).toBeVisible();
      expect(
        within(page.panel()).queryByRole('button', { name: text.refresh }),
      ).not.toBeInTheDocument();
      expect(requests).toBe(0);
    },
  );

  it.each(['exhausted', 'disabled'] as const)(
    'should preserve stale prices and avoid refresh with an %s provider budget',
    async (condition) => {
      // Arrange
      quota =
        condition === 'exhausted'
          ? { ...quota, used: 250, remaining: 0, exhausted: true }
          : { ...quota, configured: false };
      status = { ...status, providerConfigured: condition !== 'disabled', hasPendingWork: true };
      const page = openPage();
      // Assert
      expect(
        await within(await screen.findByRole('region', { name: text.title })).findByText(
          'USD 30.00',
        ),
      ).toBeVisible();
      expect(within(page.panel()).getByRole('status')).toHaveTextContent(
        condition === 'exhausted' ? text.exhausted : text.providerUnavailable,
      );
      expect(await screen.findByText(quotaRemaining(quota.remaining, quota.limit))).toBeVisible();
      expect(requests).toBe(0);
      expect(
        within(page.panel()).queryByRole('button', { name: text.refresh }),
      ).not.toBeInTheDocument();
    },
  );

  it('should show missing values without treating them as zero and show exact asset allocation and price dates', async () => {
    // Arrange
    quota = { ...quota, exhausted: true, remaining: 0 };
    valuation = priceValuation('missing');
    status = refreshStatus('missing');
    const page = openPage('/instruments/AAPL');
    // Assert
    expect(
      await within(await screen.findByRole('region', { name: text.title })).findByText(
        text.freshness.missing,
      ),
    ).toBeVisible();
    expect(within(page.panel()).getAllByText(text.noPrice).length).toBeGreaterThan(0);
    expect(within(page.panel()).queryByText('USD 0.00')).not.toBeInTheDocument();
    // Act
    valuation = priceValuation('fresh');
    status = refreshStatus('fresh');
    await page.user.click(within(page.panel()).getByRole('button', { name: text.retry }));
    // Assert
    expect(await within(page.panel()).findByText('2026-01-16')).toBeVisible();
    expect(within(page.panel()).getByText('USD 20.0000')).toBeVisible();
    expect(within(page.panel()).getAllByText('100.00%')).toHaveLength(2);
  });

  it('should retain the last valuation when a later read fails and recover through an explicit check', async () => {
    // Arrange
    valuation = priceValuation('fresh');
    status = refreshStatus('fresh');
    const page = openPage();
    await within(await screen.findByRole('region', { name: text.title })).findByText('USD 30.00');
    server.use(http.get(`${endpoint}/valuation`, () => HttpResponse.json({}, { status: 503 })));
    // Act
    await page.user.click(within(page.panel()).getByRole('button', { name: text.retry }));
    // Assert
    expect(await within(page.panel()).findByText(text.unavailable)).toBeVisible();
    expect(within(page.panel()).getByText('USD 30.00')).toBeVisible();
    // Act
    server.use(
      http.get(`${endpoint}/valuation`, () =>
        HttpResponse.json({ ...valuation, currentValue: '31' }),
      ),
    );
    await page.user.click(within(page.panel()).getByRole('button', { name: text.retry }));
    // Assert
    expect(await within(page.panel()).findByText('USD 31.00')).toBeVisible();
  });

  it('should stop automatic polling after its bound and clean up after leaving the wallet', async () => {
    // Arrange
    acceleratePricePolling();
    const page = openPage();
    await within(await screen.findByRole('region', { name: text.title })).findByText(text.pending);
    // Act
    await within(page.panel()).findByText(text.paused, {}, { timeout: 5_000 });
    // Assert
    expect(within(page.panel()).getByText(text.paused)).toBeVisible();
    const stoppedAt = reads;
    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    });
    expect(reads).toBe(stoppedAt);
    expect(reads).toBeLessThanOrEqual(pricePollLimit + 2);
    expect(requests).toBe(1);
    // Act
    await act(async () => {
      await page.router.navigate('/wallets/new');
    });
    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    });
    // Assert
    expect(reads).toBe(stoppedAt);
  });

  it('should redirect expired sessions from background pricing requests', async () => {
    // Arrange
    server.use(http.get(`${endpoint}/valuation`, () => HttpResponse.json({}, { status: 401 })));
    session
      .mockResolvedValueOnce({ data: { user: { id: 'owner' } }, error: null })
      .mockResolvedValue({ data: null, error: null });
    const page = openPage();
    // Assert
    await waitFor(() => expect(page.router.state.location.pathname).toBe('/login'));
  });
});
