import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Profiler } from 'react';
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
import { ProviderQuotaProvider } from './_components/ProviderQuotaProvider';
import { useProviderQuota, useProviderQuotaState } from './_hooks/useProviderQuota';
import { ledgerDictionary } from './ledgerDictionary';
import { pricingDictionary as text, quotaRemaining } from './pricingDictionary';
import { quotaLoader } from './pricingResource';

const counters = vi.hoisted(() => ({
  history: 0,
  historyCommits: 0,
  historyDurations: new Array<number>(),
  holdings: 0,
  summary: 0,
  quotaData: vi.fn(),
  formatUsd: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: async () => Promise.resolve({ data: { user: { id: 'owner' } }, error: null }),
    useSession: () => ({ isPending: false }),
  },
}));
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>();
  return {
    ...original,
    createApiClient: (baseUrl?: string, signal?: AbortSignal) =>
      original.createApiClient(baseUrl ?? 'http://renders.test/api', signal),
  };
});
vi.mock('@/lib/formatFinancial', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/formatFinancial')>();
  return {
    ...original,
    formatUsd: (...parameters: Parameters<typeof original.formatUsd>) => {
      counters.formatUsd();
      return original.formatUsd(...parameters);
    },
  };
});
vi.mock('./_components/TransactionHistory', async (importOriginal) => {
  const original = await importOriginal<typeof import('./_components/TransactionHistory')>();
  return {
    TransactionHistory(props: Parameters<typeof original.TransactionHistory>[0]) {
      counters.history += 1;
      return (
        <Profiler
          id="history"
          onRender={(_id, phase, actualDuration) => {
            if (phase !== 'mount') {
              counters.historyCommits += 1;
              counters.historyDurations.push(actualDuration);
            }
          }}
        >
          <original.TransactionHistory {...props} />
        </Profiler>
      );
    },
  };
});
vi.mock('./_components/HoldingList', async (importOriginal) => {
  const original = await importOriginal<typeof import('./_components/HoldingList')>();
  return {
    HoldingList(props: Parameters<typeof original.HoldingList>[0]) {
      counters.holdings += 1;
      return <original.HoldingList {...props} />;
    },
  };
});
vi.mock('./_components/LedgerSummary', async (importOriginal) => {
  const original = await importOriginal<typeof import('./_components/LedgerSummary')>();
  return {
    LedgerSummary(props: Parameters<typeof original.LedgerSummary>[0]) {
      counters.summary += 1;
      return <original.LedgerSummary {...props} />;
    },
  };
});

const base = 'http://renders.test/api';
const endpoint = `${base}/wallets/${walletSummary.id}`;
const server = setupServer();
let valuation = priceValuation('fresh');
let holdings = walletHoldings();
let remaining = providerQuota.remaining;
let valuationReads = 0;

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  counters.history = 0;
  counters.historyCommits = 0;
  counters.historyDurations = [];
  counters.holdings = 0;
  counters.summary = 0;
  counters.quotaData.mockClear();
  valuation = priceValuation('fresh');
  holdings = walletHoldings();
  remaining = providerQuota.remaining;
  valuationReads = 0;
  server.use(
    http.get(`${base}/wallets`, () =>
      HttpResponse.json({
        wallets: [],
        pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 },
      }),
    ),
    http.get(endpoint, () => HttpResponse.json(walletSummary)),
    http.get(`${endpoint}/holdings`, () => HttpResponse.json(holdings)),
    http.get(`${endpoint}/holdings/AAPL`, () => HttpResponse.json(holdings.holdings[0])),
    http.get(`${endpoint}/transactions`, () =>
      HttpResponse.json({
        ...ledgerHistory,
        transactions: ledgerHistory.transactions.map((transaction) => ({
          ...transaction,
          canDelete: false,
        })),
      }),
    ),
    http.get(`${endpoint}/valuation`, () => {
      valuationReads += 1;
      return HttpResponse.json(valuation);
    }),
    http.get(`${endpoint}/price-refresh`, () => HttpResponse.json(refreshStatus('fresh'))),
    http.get(`${base}/market-data/quota`, () =>
      HttpResponse.json({ ...providerQuota, remaining, used: providerQuota.limit - remaining }),
    ),
  );
});

async function openPage(suffix: string) {
  const router = createMemoryRouter(routeObjects, {
    initialEntries: [`/wallets/${walletSummary.id}${suffix}`],
  });
  onTestFinished(() => router.dispose());
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  const panel = await screen.findByRole('region', { name: text.title }, { timeout: 10_000 });
  await within(panel).findByText('USD 30.00');
  const retry = () => within(panel).getByRole('button', { name: text.retry });
  await waitFor(() => expect(retry()).toBeEnabled());
  await screen.findByText(quotaRemaining(remaining, providerQuota.limit));
  return {
    panel,
    async checkPrices() {
      const previousReads = valuationReads;
      await user.click(retry());
      await waitFor(() => expect(valuationReads).toBe(previousReads + 1));
      await waitFor(() => expect(retry()).toBeEnabled());
    },
    async checkQuota() {
      const match = router.state.matches.at(-1);
      if (!match) {
        throw new Error('Expected an active wallet route.');
      }
      await act(async () => {
        await router.fetch('provider-quota', match.route.id, '/market-data/quota');
      });
    },
    async reloadLedger() {
      await act(async () => {
        await router.revalidate();
      });
    },
  };
}

function snapshot() {
  return {
    history: counters.history,
    holdings: counters.holdings,
    summary: counters.summary,
    formatting: counters.formatUsd.mock.calls.length,
  };
}

function QuotaDataProbe() {
  const { data, refresh } = useProviderQuota();
  counters.quotaData();
  return (
    <>
      <output aria-label="Budget remaining">{data?.ok ? data.value.remaining : 'loading'}</output>
      <button type="button" onClick={() => void refresh()}>
        Check budget
      </button>
    </>
  );
}

function QuotaLoadingProbe() {
  const state = useProviderQuotaState();
  return <output aria-label="Budget request state">{state}</output>;
}

function QuotaTestRoute() {
  return (
    <ProviderQuotaProvider>
      <QuotaDataProbe />
      <QuotaLoadingProbe />
    </ProviderQuotaProvider>
  );
}

describe('when updating pricing independently of ledger presentation', () => {
  it('should keep ledger component bodies stable with transaction deletion controls available', async () => {
    // Arrange
    server.use(http.get(`${endpoint}/transactions`, () => HttpResponse.json(ledgerHistory)));
    const page = await openPage('');
    const initial = snapshot();
    // Act
    await page.checkPrices();
    await page.checkQuota();
    // Assert
    expect(counters.history).toBe(initial.history);
    expect(counters.holdings).toBe(initial.holdings);
    expect(counters.summary).toBe(initial.summary);
    expect(
      screen.getByRole('button', { name: ledgerDictionary.delete.open('AAPL', 'SELL') }),
    ).toBeEnabled();
  });

  it('should update quota loading feedback without rerendering consumers of quota data', async () => {
    // Arrange
    const router = createMemoryRouter([
      {
        Component: QuotaTestRoute,
        children: [
          { index: true, element: null },
          { path: 'market-data/quota', loader: quotaLoader },
        ],
      },
    ]);
    onTestFinished(() => router.dispose());
    render(<RouterProvider router={router} />);
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Budget remaining' })).toHaveTextContent(
        String(remaining),
      ),
    );
    const initialDataRenders = counters.quotaData.mock.calls.length;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(release);
    remaining -= 1;
    server.use(
      http.get(`${base}/market-data/quota`, async () => {
        await gate;
        return HttpResponse.json({
          ...providerQuota,
          remaining,
          used: providerQuota.limit - remaining,
        });
      }),
    );
    // Act
    await user.click(screen.getByRole('button', { name: 'Check budget' }));
    // Assert
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Budget request state' })).toHaveTextContent(
        'loading',
      ),
    );
    expect(counters.quotaData).toHaveBeenCalledTimes(initialDataRenders);
    // Act
    act(() => {
      release();
    });
    // Assert
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Budget remaining' })).toHaveTextContent(
        String(remaining),
      ),
    );
    expect(counters.quotaData).toHaveBeenCalledTimes(initialDataRenders + 1);
  });

  it.each(['', '/instruments/AAPL'])(
    'should keep unchanged ledger rendering and financial formatting stable during pricing/quota checks on %s',
    async (suffix) => {
      // Arrange
      const page = await openPage(suffix);
      const initial = snapshot();
      const initialProfilerCommits = counters.historyCommits;
      const initialDurations = counters.historyDurations.length;
      // Act
      await page.checkPrices();
      await page.checkPrices();
      await page.checkQuota();
      // Assert
      expect(snapshot()).toEqual(initial);
      console.info(
        JSON.stringify({
          view: suffix || 'wallet',
          historyRenders: counters.history - initial.history,
          profilerCommits: counters.historyCommits - initialProfilerCommits,
          profilerDurationsMs: counters.historyDurations.slice(initialDurations),
        }),
      );
      // Act
      remaining -= 1;
      await page.checkQuota();
      // Assert
      expect(await screen.findByText(quotaRemaining(remaining, providerQuota.limit))).toBeVisible();
      expect(snapshot()).toEqual(initial);
    },
  );

  it.each(['', '/instruments/AAPL'])(
    'should display changed price data while keeping history and ledger summary stable on %s',
    async (suffix) => {
      // Arrange
      const page = await openPage(suffix);
      const initial = snapshot();
      const updated = priceValuation('fresh');
      valuation = {
        ...updated,
        currentValue: '31',
        holdings: updated.holdings.map((holding) => ({ ...holding, currentValue: '31' })),
      };
      // Act
      await page.checkPrices();
      // Assert
      expect(within(page.panel).getByText('USD 31.00')).toBeVisible();
      expect(counters.history).toBe(initial.history);
      expect(counters.summary).toBe(initial.summary);
      expect(counters.formatUsd.mock.calls.length).toBeGreaterThan(initial.formatting);
      // Act
      holdings = { ...holdings, remainingCostBasis: '12' };
      await page.reloadLedger();
      // Assert
      expect(counters.summary).toBeGreaterThan(initial.summary);
      expect(counters.history).toBeGreaterThan(initial.history);
    },
  );
});
