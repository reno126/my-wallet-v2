import { act, render, screen, waitFor, within } from '@testing-library/react';
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
import { pricingDictionary as text } from './pricingDictionary';

const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: session, useSession: () => ({ isPending: false }) },
}));
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>();
  return {
    ...original,
    createApiClient: (baseUrl?: string, signal?: AbortSignal) =>
      original.createApiClient(baseUrl ?? 'http://market-day.test/api', signal),
  };
});

const base = 'http://market-day.test/api';
const endpoint = `${base}/wallets/${walletSummary.id}`;
const server = setupServer();
let valuation = priceValuation('fresh');
let status = refreshStatus('fresh');
let quota = { ...providerQuota };
let reads = 0;
let statusReads = 0;
let quotaReads = 0;
let requests = 0;
let pageReads = 0;
let outcome = 202;

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-20T04:59:59Z'));
  valuation = priceValuation('fresh');
  status = refreshStatus('fresh');
  quota = { ...providerQuota };
  reads = 0;
  statusReads = 0;
  quotaReads = 0;
  requests = 0;
  pageReads = 0;
  outcome = 202;
  session.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  server.use(
    http.get(endpoint, () => {
      pageReads += 1;
      return HttpResponse.json(walletSummary);
    }),
    http.get(`${endpoint}/holdings`, () => {
      pageReads += 1;
      return HttpResponse.json(walletHoldings());
    }),
    http.get(`${endpoint}/holdings/AAPL`, () => {
      pageReads += 1;
      return HttpResponse.json(walletHoldings().holdings[0]);
    }),
    http.get(`${endpoint}/transactions`, () => {
      pageReads += 1;
      return HttpResponse.json(ledgerHistory);
    }),
    http.get(`${endpoint}/valuation`, () => {
      reads += 1;
      return HttpResponse.json(valuation);
    }),
    http.get(`${endpoint}/price-refresh`, () => {
      statusReads += 1;
      return HttpResponse.json(status);
    }),
    http.get(`${base}/market-data/quota`, () => {
      quotaReads += 1;
      return HttpResponse.json(quota);
    }),
    http.post(`${endpoint}/price-refresh`, () => {
      requests += 1;
      if (outcome !== 202) {
        return HttpResponse.json({}, { status: outcome });
      }
      valuation = priceValuation('fresh');
      status = refreshStatus('fresh');
      return HttpResponse.json(
        { walletId: walletSummary.id, requestedSymbols: ['AAPL'] },
        { status: 202 },
      );
    }),
  );
});

function advanceMarketDay() {
  vi.setSystemTime(new Date('2026-01-20T05:00:01Z'));
  quota = { ...quota, quotaDate: '2026-01-20', resetsAt: '2026-01-21T05:00:00Z' };
  valuation = priceValuation('stale');
  status = refreshStatus('stale');
}

function returnToPage() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

function accelerateQuotaChecks() {
  const schedule = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(
    (handler, timeout, ...arguments_: unknown[]) =>
      schedule(handler, timeout === 30_000 ? 100 : timeout, ...arguments_),
  );
}

async function openPage(suffix = '') {
  const router = createMemoryRouter(routeObjects, {
    initialEntries: [`/wallets/${walletSummary.id}${suffix}`],
  });
  onTestFinished(() => router.dispose());
  const view = render(<RouterProvider router={router} />);
  const panel = await screen.findByRole('region', { name: text.title }, { timeout: 10_000 });
  await within(panel).findByText('USD 30.00');
  const settled = () =>
    waitFor(() => expect(within(panel).getByRole('button', { name: text.retry })).toBeEnabled());
  await settled();
  const initialPageReads = pageReads;
  const initialSessionReads = session.mock.calls.length;
  return {
    panel,
    settled,
    unmount: view.unmount,
    expectLedgerUnchanged() {
      expect(pageReads).toBe(initialPageReads);
      expect(session).toHaveBeenCalledTimes(initialSessionReads);
    },
  };
}

describe('when a mounted pricing view crosses a market day', () => {
  it.each(['', '/instruments/AAPL'])(
    'should check server freshness on return and refresh once on the new day on %s',
    async (suffix) => {
      // Arrange
      const page = await openPage(suffix);
      expect(within(page.panel).getByText(text.freshness.fresh)).toBeVisible();
      // Act
      advanceMarketDay();
      returnToPage();
      // Assert
      await waitFor(() => expect(requests).toBe(1));
      await within(page.panel).findByText(text.freshness.fresh);
      await page.settled();
      expect(within(page.panel).getByText(text.freshness.fresh)).toBeVisible();
      expect(reads).toBeLessThanOrEqual(4);
      expect(statusReads).toBe(reads);
      page.expectLedgerUnchanged();
      const settledReads = reads;
      // Act
      returnToPage();
      // Assert
      await page.settled();
      expect(reads).toBe(settledReads);
      expect(requests).toBe(1);
    },
  );

  it('should recheck a visible page when the existing quota timer reports a new server day', async () => {
    // Arrange
    accelerateQuotaChecks();
    const page = await openPage();
    const initialQuotaReads = quotaReads;
    // Act
    advanceMarketDay();
    // Assert
    await waitFor(() => expect(requests).toBe(1));
    await within(page.panel).findByText(text.freshness.fresh);
    await page.settled();
    await waitFor(() => expect(quotaReads).toBeGreaterThan(initialQuotaReads + 3));
    expect(reads).toBe(3);
    expect(statusReads).toBe(3);
    expect(within(page.panel).getByText(text.freshness.fresh)).toBeVisible();
    page.expectLedgerUnchanged();
  });

  it('should wait for the current quota check before assigning a daily automatic attempt', async () => {
    // Arrange
    const page = await openPage();
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
    // Act
    advanceMarketDay();
    returnToPage();
    // Assert
    await within(page.panel).findByText(text.freshness.stale);
    await page.settled();
    expect(requests).toBe(0);
    // Act
    act(release);
    // Assert
    await waitFor(() => expect(requests).toBe(1));
    await within(page.panel).findByText(text.freshness.fresh);
    await page.settled();
    expect(requests).toBe(1);
    page.expectLedgerUnchanged();
  });

  it.each([429, 503])(
    'should allow a new daily attempt after HTTP %s and never retry it repeatedly that day',
    async (failureStatus) => {
      // Arrange
      accelerateQuotaChecks();
      outcome = failureStatus;
      valuation = priceValuation('stale');
      status = refreshStatus('stale');
      const page = await openPage();
      await waitFor(() => expect(requests).toBe(1));
      await page.settled();
      // Act
      advanceMarketDay();
      // Assert
      await waitFor(() => expect(requests).toBe(2));
      await page.settled();
      expect(within(page.panel).getByText(text.freshness.stale)).toBeVisible();
      expect(within(page.panel).getByText('USD 30.00')).toBeVisible();
      const previousQuotaReads = quotaReads;
      // Act
      returnToPage();
      vi.setSystemTime(new Date('2026-01-20T05:01:01Z'));
      returnToPage();
      // Assert
      await page.settled();
      await waitFor(() => expect(quotaReads).toBeGreaterThan(previousQuotaReads + 2));
      expect(requests).toBe(2);
      page.expectLedgerUnchanged();
    },
  );

  it('should use the configured server day rather than browser or New York midnight and honor exhausted quota', async () => {
    // Arrange
    accelerateQuotaChecks();
    quota = { ...quota, timeZone: 'Asia/Tokyo', resetsAt: '2026-01-19T15:00:00Z' };
    vi.setSystemTime(new Date('2026-01-19T14:59:59Z'));
    const page = await openPage();
    // Act
    vi.setSystemTime(new Date('2026-01-19T15:00:01Z'));
    quota = {
      ...quota,
      quotaDate: '2026-01-20',
      resetsAt: '2026-01-20T15:00:00Z',
      remaining: 0,
      used: quota.limit,
      exhausted: true,
    };
    valuation = priceValuation('stale');
    status = refreshStatus('stale');
    // Assert
    await within(page.panel).findByText(text.exhausted);
    await page.settled();
    expect(reads).toBe(2);
    expect(requests).toBe(0);
    expect(within(page.panel).getByText(text.freshness.stale)).toBeVisible();
    page.expectLedgerUnchanged();
  });

  it.each(['valuation', 'status', 'quota'])(
    'should retain cached values after a failed %s check and recover on a later return',
    async (failedRead) => {
      // Arrange
      const page = await openPage();
      const failedEndpoint =
        failedRead === 'quota'
          ? `${base}/market-data/quota`
          : `${endpoint}/${failedRead === 'status' ? 'price-refresh' : 'valuation'}`;
      server.use(http.get(failedEndpoint, () => HttpResponse.json({}, { status: 503 })));
      // Act
      advanceMarketDay();
      returnToPage();
      // Assert
      const message =
        failedRead === 'quota'
          ? text.quota.refreshUnavailable
          : failedRead === 'status'
            ? text.statusUnavailable
            : text.unavailable;
      await within(page.panel).findByText(message);
      await page.settled();
      expect(within(page.panel).getByText('USD 30.00')).toBeVisible();
      expect(requests).toBe(0);
      const failedReads = reads;
      // Act
      returnToPage();
      // Assert
      expect(reads).toBe(failedReads);
      // Arrange
      server.use(
        http.get(failedEndpoint, () =>
          HttpResponse.json(
            failedRead === 'quota' ? quota : failedRead === 'status' ? status : valuation,
          ),
        ),
      );
      // Act
      vi.setSystemTime(new Date('2026-01-20T05:01:01Z'));
      returnToPage();
      // Assert
      await waitFor(() => expect(requests).toBe(1));
      await within(page.panel).findByText(text.freshness.fresh);
      await page.settled();
      page.expectLedgerUnchanged();
    },
  );

  it('should ignore hidden events, coalesce return events, retain values while checking and remove listeners on unmount', async () => {
    // Arrange
    const page = await openPage();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    // Act
    returnToPage();
    // Assert
    expect(reads).toBe(1);
    // Arrange
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(release);
    server.use(
      http.get(`${endpoint}/valuation`, async () => {
        reads += 1;
        await gate;
        return HttpResponse.json(valuation);
      }),
    );
    visibility.mockReturnValue('visible');
    // Act
    returnToPage();
    // Assert
    await waitFor(() => expect(reads).toBe(2));
    expect(within(page.panel).getByText('USD 30.00')).toBeVisible();
    // Act
    returnToPage();
    act(release);
    await page.settled();
    returnToPage();
    // Assert
    expect(reads).toBe(2);
    // Act
    vi.setSystemTime(new Date('2026-01-20T05:01:01Z'));
    returnToPage();
    // Assert
    await waitFor(() => expect(reads).toBe(3));
    await page.settled();
    // Act
    page.unmount();
    vi.setSystemTime(new Date('2026-01-20T05:02:01Z'));
    returnToPage();
    // Assert
    expect(reads).toBe(3);
    expect(requests).toBe(0);
    page.expectLedgerUnchanged();
  });
});
