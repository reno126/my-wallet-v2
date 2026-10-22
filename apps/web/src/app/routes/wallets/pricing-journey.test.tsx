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

import { appDictionary } from '../../appDictionary';
import { routeObjects } from '../../router';
import { pricePollIntervalMs, pricePollLimit } from './_utils/pricePolling';
import { ledgerDictionary } from './ledgerDictionary';
import { pricingDictionary as text, quotaRemaining } from './pricingDictionary';
import { walletDictionary } from './walletDictionary';

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
  const user = userEvent.setup();
  const panel = () => screen.getByRole('region', { name: text.title });
  return {
    router,
    user,
    panel,
    async retryPricing() {
      const retry = within(panel()).getByRole('button', { name: text.retry });
      await waitFor(() => expect(retry).toBeEnabled());
      await user.click(retry);
    },
  };
}

function acceleratePricePolling() {
  const schedule = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(
    (handler, timeout, ...arguments_: unknown[]) =>
      schedule(handler, timeout === pricePollIntervalMs ? 10 : timeout, ...arguments_),
  );
}

function mockOtherWallet() {
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
    http.get(`${otherEndpoint}/valuation`, () =>
      HttpResponse.json({ ...priceValuation('not_required'), walletId: otherId, holdings: [] }),
    ),
    http.get(`${otherEndpoint}/price-refresh`, () =>
      HttpResponse.json({ ...refreshStatus('not_required'), walletId: otherId, holdings: [] }),
    ),
  );
  return { id: otherId, endpoint: otherEndpoint, path: `/wallets/${otherId}` };
}

describe('when showing cached valuations and refresh progress', () => {
  it('should expose quota loading accessibly and keep exhaustion visible while toggling budget details with the keyboard', async () => {
    // Arrange
    quota = { ...quota, remaining: 0, used: 250, exhausted: true };
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(release);
    server.use(
      http.get(`${base}/market-data/quota`, async () => {
        await gate;
        return HttpResponse.json(quota);
      }),
    );
    const page = openPage();
    const budget = await screen.findByRole(
      'complementary',
      { name: text.quota.title },
      { timeout: 10_000 },
    );
    // Assert
    expect(within(budget).getByRole('status', { name: text.quota.loading })).toBeVisible();
    // Act
    act(() => {
      release();
    });
    const details = await within(budget).findByRole('button', { name: text.quota.details });
    // Assert
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(within(budget).getByText(text.exhausted)).toBeVisible();
    expect(within(budget).queryByText(text.quota.tracked)).not.toBeInTheDocument();
    // Act
    await page.user.click(details);
    // Assert
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(within(budget).getByText(text.quota.tracked)).toBeVisible();
    expect(within(budget).getByText(quotaRemaining(0, 250))).toBeVisible();
    // Act
    await page.user.keyboard('{Enter}');
    // Assert
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(within(budget).queryByText(text.quota.tracked)).not.toBeInTheDocument();
    expect(within(budget).getByText(text.exhausted)).toBeVisible();
    expect(details).toHaveFocus();
    expect(requests).toBe(0);
  });

  it('should mark only active refresh requests busy while preserving the cached valuation', async () => {
    // Arrange
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(release);
    server.use(
      http.post(`${endpoint}/price-refresh`, async () => {
        requests += 1;
        await gate;
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
    const page = openPage();
    const panel = await screen.findByRole('region', { name: text.title });
    const refresh = await within(panel).findByRole('button', { name: text.refresh });
    // Assert
    await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'true'));
    expect(refresh).toBeDisabled();
    expect(within(panel).getByText('USD 30.00')).toBeVisible();
    // Act
    act(() => {
      release();
    });
    // Assert
    expect(await within(panel).findByText(text.pending)).toBeVisible();
    await waitFor(() => expect(refresh).toBeEnabled());
    expect(refresh).toHaveAttribute('aria-busy', 'false');
    expect(within(panel).getByText('USD 30.00')).toBeVisible();
    expect(requests).toBe(1);
    expect(page.router.state.location.pathname).toBe(path);
  });

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
    await page.retryPricing();
    // Assert
    expect(await within(page.panel()).findByText(text.failed)).toBeVisible();
    expect(requests).toBe(1);
  });

  it.each(['', '/instruments/AAPL'])(
    'should explain a paid-plan price restriction on %s while retaining cached values',
    async (suffix) => {
      // Arrange
      quota = { ...quota, exhausted: true, used: 250, remaining: 0 };
      status = {
        ...status,
        holdings: status.holdings.map((holding) => ({
          ...holding,
          status: 'failed',
          lastFailureCode: 'PROVIDER_PAYMENT_REQUIRED',
        })),
      };
      const page = openPage(suffix);
      // Assert
      expect(
        await within(await screen.findByRole('region', { name: text.title })).findByText(
          text.paymentRequired,
        ),
      ).toBeVisible();
      expect(within(page.panel()).getByText('USD 30.00')).toBeVisible();
      expect(requests).toBe(0);
    },
  );

  it('should not attribute another holding’s paid-plan restriction to the selected asset', async () => {
    // Arrange
    quota = { ...quota, exhausted: true, used: 250, remaining: 0 };
    valuation = {
      ...priceValuation(),
      remainingCostBasis: '30',
      currentValue: '60',
      unrealizedProfitLoss: '30',
      holdings: [
        ...priceValuation('fresh').holdings.map((holding) => ({
          ...holding,
          allocationPercentage: '50',
        })),
        ...priceValuation().holdings.map((holding) => ({
          ...holding,
          symbol: 'MSFT',
          name: 'Microsoft',
          allocationPercentage: '50',
        })),
      ],
    };
    status = {
      ...status,
      holdings: [
        ...refreshStatus('fresh').holdings,
        ...status.holdings.map((holding): typeof holding => ({
          ...holding,
          symbol: 'MSFT',
          status: 'failed',
          lastFailureCode: 'PROVIDER_PAYMENT_REQUIRED',
        })),
      ],
    };
    const page = openPage('/instruments/AAPL');
    // Assert
    expect(
      await within(await screen.findByRole('region', { name: text.title })).findByText(
        text.freshness.fresh,
      ),
    ).toBeVisible();
    expect(within(page.panel()).queryByText(text.paymentRequired)).not.toBeInTheDocument();
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
    const other = mockOtherWallet();
    server.use(
      http.get(`${other.endpoint}/valuation`, () => HttpResponse.json({}, { status: 503 })),
      http.get(`${other.endpoint}/price-refresh`, () => HttpResponse.json({}, { status: 503 })),
    );
    // Act
    await act(async () => {
      await page.router.navigate(other.path);
    });
    // Assert
    expect(await within(page.panel()).findByText(text.unavailable)).toBeVisible();
    expect(within(page.panel()).queryByText('USD 30.00')).not.toBeInTheDocument();
    expect(requests).toBe(0);
  });

  it.each(['', '/instruments/AAPL'])(
    'should isolate a rejected refresh when changing wallets from %s',
    async (suffix) => {
      // Arrange
      server.use(
        http.post(`${endpoint}/price-refresh`, () =>
          HttpResponse.json(
            { error: { code: 'RATE_LIMITED', message: 'Limited', requestId: walletSummary.id } },
            { status: 429 },
          ),
        ),
      );
      const other = mockOtherWallet();
      const page = openPage(suffix);
      await within(await screen.findByRole('region', { name: text.title })).findByText(
        text.limited,
      );
      server.use(
        http.get(`${other.endpoint}/holdings/AAPL`, () =>
          HttpResponse.json({ ...walletHoldings().holdings[0], walletId: other.id }),
        ),
        http.get(`${other.endpoint}/valuation`, () =>
          HttpResponse.json({
            ...priceValuation('fresh'),
            walletId: other.id,
            holdings: priceValuation('fresh').holdings.map((holding) => ({
              ...holding,
              walletId: other.id,
            })),
          }),
        ),
      );
      // Act
      await act(async () => {
        await page.router.navigate(other.path + suffix);
      });
      // Assert
      expect(await within(page.panel()).findByText(text.freshness.fresh)).toBeVisible();
      expect(within(page.panel()).queryByText(text.limited)).not.toBeInTheDocument();
    },
  );

  it('should start a new bounded polling session when returning to a paused wallet', async () => {
    // Arrange
    acceleratePricePolling();
    const other = mockOtherWallet();
    const page = openPage();
    await within(await screen.findByRole('region', { name: text.title })).findByText(
      text.paused,
      {},
      { timeout: 10_000 },
    );
    const previousReads = reads;
    // Act
    await act(async () => {
      await page.router.navigate(other.path);
    });
    await within(page.panel()).findByText(text.freshness.not_required);
    await act(async () => {
      await page.router.navigate(path);
    });
    // Assert
    expect(await within(page.panel()).findByText(text.pending)).toBeVisible();
    await waitFor(() => expect(requests).toBe(2));
    await waitFor(() => expect(reads).toBeGreaterThan(previousReads + 2));
    expect(within(page.panel()).queryByText(text.paused)).not.toBeInTheDocument();
  });

  it.each(['fresh', 'stale'] as const)(
    'should preserve %s values and report a quota failure separately',
    async (freshness) => {
      // Arrange
      valuation = priceValuation(freshness);
      status = refreshStatus(freshness);
      server.use(
        http.get(`${base}/market-data/quota`, () => HttpResponse.json({}, { status: 503 })),
      );
      const page = openPage();
      // Assert
      await within(await screen.findByRole('region', { name: text.title })).findByText(
        text.freshness[freshness],
      );
      expect(await screen.findByText(text.quota.unavailable)).toBeVisible();
      expect(within(page.panel()).getByText('USD 30.00')).toBeVisible();
      expect(within(page.panel()).queryByText(text.unavailable)).not.toBeInTheDocument();
      if (freshness === 'stale') {
        expect(within(page.panel()).getByText(text.quota.refreshUnavailable)).toBeVisible();
      }
      expect(requests).toBe(0);
    },
  );

  it('should preserve values and recover a failed refresh-status read independently', async () => {
    // Arrange
    valuation = priceValuation('fresh');
    status = refreshStatus('fresh');
    server.use(http.get(`${endpoint}/price-refresh`, () => HttpResponse.json({}, { status: 503 })));
    const page = openPage();
    // Assert
    expect(
      await within(await screen.findByRole('region', { name: text.title })).findByText(
        text.statusUnavailable,
      ),
    ).toBeVisible();
    expect(within(page.panel()).getByText('USD 30.00')).toBeVisible();
    expect(within(page.panel()).queryByText(text.unavailable)).not.toBeInTheDocument();
    // Act
    server.use(http.get(`${endpoint}/price-refresh`, () => HttpResponse.json(status)));
    await page.retryPricing();
    // Assert
    await waitFor(() =>
      expect(within(page.panel()).queryByText(text.statusUnavailable)).not.toBeInTheDocument(),
    );
  });

  it('should share an in-flight quota read between navigation and explicit pricing checks', async () => {
    // Arrange
    valuation = priceValuation('fresh');
    status = refreshStatus('fresh');
    let quotaReads = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(release);
    server.use(
      http.get(`${base}/market-data/quota`, async () => {
        quotaReads += 1;
        await gate;
        return HttpResponse.json(quota);
      }),
    );
    const page = openPage();
    await within(await screen.findByRole('region', { name: text.title })).findByText('USD 30.00');
    await waitFor(() => expect(quotaReads).toBe(1));
    // Act
    await page.retryPricing();
    await waitFor(() =>
      expect(within(page.panel()).getByRole('button', { name: text.retry })).toBeEnabled(),
    );
    // Assert
    expect(quotaReads).toBe(1);
    // Act
    act(release);
    // Assert
    expect(await screen.findByText(quotaRemaining(quota.remaining, quota.limit))).toBeVisible();
  });

  it.each(['GET', 'POST'] as const)(
    'should treat a malformed pricing resource ID in %s as an unavailable page',
    async (method) => {
      // Arrange
      const page = openPage();
      await screen.findByRole('region', { name: text.title });
      // Act
      await act(async () => {
        await page.router.navigate(
          '/wallets/invalid/pricing',
          method === 'POST' ? { formMethod: 'post', formData: new FormData() } : undefined,
        );
      });
      // Assert
      expect(
        await screen.findByRole('heading', { name: walletDictionary.detail.unavailable }),
      ).toBeVisible();
      expect(screen.getByText(walletDictionary.detail.unavailableDescription)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: appDictionary.pageErrors.reload }),
      ).not.toBeInTheDocument();
    },
  );

  it('should stop showing an old rate-limit failure once a revalidation finds fresh prices', async () => {
    // Arrange
    server.use(
      http.post(`${endpoint}/price-refresh`, () =>
        HttpResponse.json(
          { error: { code: 'RATE_LIMITED', message: 'Limited', requestId: walletSummary.id } },
          { status: 429 },
        ),
      ),
    );
    const page = openPage();
    await within(await screen.findByRole('region', { name: text.title })).findByText(text.limited);
    valuation = priceValuation('fresh');
    status = refreshStatus('fresh');
    // Act
    await act(async () => {
      await page.router.revalidate();
    });
    // Assert
    expect(await within(page.panel()).findByText(text.freshness.fresh)).toBeVisible();
    expect(within(page.panel()).queryByText(text.limited)).not.toBeInTheDocument();
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
    expect(within(page.panel()).getByRole('status', { name: text.loading })).toBeVisible();
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
      await waitFor(() =>
        expect(within(page.panel()).getByRole('status')).toHaveTextContent(
          condition === 'exhausted' ? text.exhausted : text.providerUnavailable,
        ),
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
    await page.retryPricing();
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
    await page.retryPricing();
    // Assert
    expect(await within(page.panel()).findByText(text.unavailable)).toBeVisible();
    expect(within(page.panel()).getByText('USD 30.00')).toBeVisible();
    // Act
    server.use(
      http.get(`${endpoint}/valuation`, () =>
        HttpResponse.json({ ...valuation, currentValue: '31' }),
      ),
    );
    await page.retryPricing();
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
