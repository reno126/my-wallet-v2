import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
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

import { createTransactionSchema } from '@my-wallets/contracts';
import { ledgerHistory, ledgerHolding, walletHoldings } from '@/test/ledger-api';
import { unavailablePricingHandlers } from '@/test/market-data-api';
import { walletSummary } from '@/test/wallet-api';

import { routeObjects } from '../../router';
import { ledgerDictionary as text } from './ledgerDictionary';
import { pricingDictionary } from './pricingDictionary';

const probes = vi.hoisted(() => ({ schema: vi.fn(), mutationMount: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: () => Promise.resolve({ data: { user: { id: 'owner' } }, error: null }),
    useSession: () => ({ isPending: false }),
  },
}));
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>();
  return {
    ...original,
    createApiClient: (baseUrl?: string, signal?: AbortSignal) =>
      original.createApiClient(baseUrl ?? 'http://sales.test/api', signal),
  };
});
vi.mock('./_utils/sellForm', async (importOriginal) => {
  const original = await importOriginal<typeof import('./_utils/sellForm')>();
  return {
    ...original,
    sellFormSchema(available: string) {
      probes.schema(available);
      return original.sellFormSchema(available);
    },
  };
});
vi.mock('./_hooks/useTransactionMutation', async (importOriginal) => {
  const original = await importOriginal<typeof import('./_hooks/useTransactionMutation')>();
  return {
    useTransactionMutation() {
      useEffect(() => {
        probes.mutationMount();
      }, []);
      return original.useTransactionMutation();
    },
  };
});

const base = 'http://sales.test/api';
const endpoint = `${base}/wallets/${walletSummary.id}`;
const server = setupServer(...unavailablePricingHandlers(base));
let holdings = [
  ledgerHolding,
  {
    ...ledgerHolding,
    symbol: 'MSFT',
    name: 'Microsoft',
    quantity: '0.25',
    remainingCostBasis: '2.5',
  },
];
const posted: unknown[] = [];
beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  toast.dismiss();
});
beforeEach(() => {
  holdings = [
    ledgerHolding,
    {
      ...ledgerHolding,
      symbol: 'MSFT',
      name: 'Microsoft',
      quantity: '0.25',
      remainingCostBasis: '2.5',
    },
  ];
  posted.length = 0;
  server.use(
    http.get(`${base}/wallets`, () =>
      HttpResponse.json({
        wallets: [],
        pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 },
      }),
    ),
    http.get(endpoint, () => HttpResponse.json(walletSummary)),
    http.get(`${endpoint}/holdings`, () => HttpResponse.json(walletHoldings(holdings))),
    http.get(`${endpoint}/transactions`, () =>
      HttpResponse.json({
        ...ledgerHistory,
        transactions: ledgerHistory.transactions.map((entry) => ({ ...entry, canDelete: false })),
      }),
    ),
    http.post(`${endpoint}/transactions`, async ({ request }) => {
      const input = createTransactionSchema.parse(await request.json());
      posted.push(input);
      holdings = holdings.map((holding) =>
        holding.symbol === input.symbol
          ? { ...holding, quantity: '0.15', remainingCostBasis: '1.5' }
          : holding,
      );
      return HttpResponse.json(
        {
          transaction: {
            ...input,
            id: '5e414ffe-56a1-4c25-9caf-a661474640b8',
            walletId: walletSummary.id,
            createdAt: '2026-10-27T12:00:00Z',
          },
          holding: {
            walletId: walletSummary.id,
            symbol: input.symbol,
            quantity: '0.15',
            quoteCurrency: 'USD',
          },
        },
        { status: 201 },
      );
    }),
  );
});

async function openPage() {
  const router = createMemoryRouter(routeObjects, {
    initialEntries: [`/wallets/${walletSummary.id}`],
  });
  onTestFinished(() => router.dispose());
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: text.holdings }, { timeout: 10_000 });
  const user = userEvent.setup();
  const trigger = (symbol: string) => screen.getByRole('button', { name: text.sell.open(symbol) });
  return {
    user,
    trigger,
    async select(symbol: string) {
      await user.click(trigger(symbol));
    },
    async fill(quantity = '0.5') {
      await user.type(screen.getByRole('textbox', { name: text.sell.quantity }), quantity);
      await user.type(screen.getByRole('textbox', { name: text.sell.price }), '20');
    },
    async submit() {
      await user.click(screen.getByRole('button', { name: text.sell.submit }));
    },
    async close() {
      await user.click(screen.getByRole('button', { name: text.cancel }));
    },
    async quotaCheck() {
      const match = router.state.matches.at(-1);
      if (!match) {
        throw new Error('Expected a wallet route.');
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

describe('when lazily creating the shared sale editor', () => {
  it('should create no sale forms for 80 holdings or background checks, then initialize only the selected form', async () => {
    // Arrange
    holdings = Array.from({ length: 80 }, (_slot, index) => ({
      ...ledgerHolding,
      symbol: `S${index}`,
      quantity: index % 2 === 0 ? '1.5' : '0',
    }));
    const page = await openPage();
    // Assert
    expect(probes.schema).not.toHaveBeenCalled();
    expect(probes.mutationMount).toHaveBeenCalledTimes(1);
    expect(page.trigger('S1')).toBeDisabled();
    // Act
    await page.quotaCheck();
    const panel = screen.getByRole('region', { name: pricingDictionary.title });
    const check = within(panel).getByRole('button', { name: pricingDictionary.retry });
    await waitFor(() => expect(check).toBeEnabled());
    await page.user.click(check);
    await waitFor(() => expect(check).toBeEnabled());
    // Assert
    expect(probes.schema).not.toHaveBeenCalled();
    expect(probes.mutationMount).toHaveBeenCalledTimes(1);
    // Act
    await page.select('S0');
    await page.quotaCheck();
    // Assert
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(probes.schema).toHaveBeenCalledExactlyOnceWith('1.5');
    expect(probes.mutationMount).toHaveBeenCalledTimes(1);
    // Act
    await page.close();
    // Assert
    await waitFor(() => expect(page.trigger('S0')).toHaveFocus());
  });

  it('should reset a cancelled form and use the next position’s quantity and symbol', async () => {
    // Arrange
    const page = await openPage();
    await page.select('AAPL');
    await page.fill();
    await page.close();
    // Act
    await page.select('MSFT');
    // Assert
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('');
    expect(screen.getByText(`${text.sell.available}: 0.25`)).toBeVisible();
    expect(probes.schema).toHaveBeenLastCalledWith('0.25');
    // Act
    await page.fill();
    await page.submit();
    // Assert
    expect(posted).toHaveLength(0);
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toBeInvalid();
    // Act
    await page.user.clear(screen.getByRole('textbox', { name: text.sell.quantity }));
    await page.user.type(screen.getByRole('textbox', { name: text.sell.quantity }), '0.1');
    await page.submit();
    // Assert
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posted).toEqual([
      expect.objectContaining({ side: 'SELL', symbol: 'MSFT', quantity: '0.1' }),
    ]);
  });

  it('should clear a confirmed rejection before opening another holding', async () => {
    // Arrange
    server.use(
      http.post(`${endpoint}/transactions`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'INSUFFICIENT_HOLDING',
              message: 'Conflict',
              requestId: walletSummary.id,
            },
          },
          { status: 409 },
        ),
      ),
    );
    const page = await openPage();
    await page.select('AAPL');
    await page.fill();
    await page.submit();
    await within(screen.getByRole('dialog')).findByText(text.errors.insufficient);
    // Act
    await page.close();
    await page.select('MSFT');
    // Assert
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('');
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.sell.submit })).toBeEnabled();
  });

  it('should retain an unconfirmed form across closing and block switching until ledger recovery', async () => {
    // Arrange
    let posts = 0;
    server.use(
      http.post(`${endpoint}/transactions`, () => {
        posts += 1;
        return HttpResponse.json({}, { status: 503 });
      }),
    );
    const page = await openPage();
    await page.select('AAPL');
    await page.fill();
    await page.submit();
    await within(screen.getByRole('dialog')).findByText(text.errors.unconfirmed);
    // Act
    await page.close();
    // Assert
    expect(page.trigger('MSFT')).toBeDisabled();
    // Act
    await page.select('AAPL');
    // Assert
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('0.5');
    expect(screen.getByRole('button', { name: text.sell.submit })).toBeDisabled();
    expect(probes.schema).toHaveBeenCalledTimes(1);
    // Act
    await page.user.click(screen.getByRole('button', { name: text.refresh }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: text.sell.submit })).toBeEnabled(),
    );
    await page.close();
    await page.select('MSFT');
    // Assert
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('');
    expect(posts).toBe(1);
  });

  it('should let an uncertain closed position reopen for recovery while keeping resubmission blocked', async () => {
    // Arrange
    server.use(http.post(`${endpoint}/transactions`, () => HttpResponse.json({}, { status: 503 })));
    const page = await openPage();
    await page.select('AAPL');
    await page.fill();
    await page.submit();
    await within(screen.getByRole('dialog')).findByText(text.errors.unconfirmed);
    await page.close();
    // Act
    holdings = holdings.map((holding) =>
      holding.symbol === 'AAPL'
        ? {
            ...holding,
            quantity: '0',
            remainingCostBasis: '0',
            averageUnitCost: null,
          }
        : holding,
    );
    await page.reloadLedger();
    await page.select('AAPL');
    // Assert
    expect(screen.getByText(`${text.sell.available}: 0`)).toBeVisible();
    expect(screen.getByRole('button', { name: text.sell.submit })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('0.5');
    // Act
    await page.user.click(screen.getByRole('button', { name: text.refresh }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: text.sell.submit })).toBeEnabled(),
    );
    await page.close();
    // Assert
    expect(page.trigger('AAPL')).toBeDisabled();
    expect(page.trigger('MSFT')).toBeEnabled();
  });

  it('should prevent cancellation and repeated submission while the sale is pending', async () => {
    // Arrange
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(release);
    let posts = 0;
    server.use(
      http.post(`${endpoint}/transactions`, async () => {
        posts += 1;
        await gate;
        return HttpResponse.json({}, { status: 503 });
      }),
    );
    const page = await openPage();
    const otherTrigger = page.trigger('MSFT');
    await page.select('AAPL');
    await page.fill();
    // Act
    await page.submit();
    // Assert
    expect(await screen.findByRole('button', { name: text.sell.pending })).toBeDisabled();
    expect(screen.getByRole('button', { name: text.cancel })).toBeDisabled();
    await waitFor(() => expect(otherTrigger).toBeDisabled());
    // Act
    await page.user.keyboard('{Escape}');
    // Assert
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(posts).toBe(1);
    // Act
    act(() => {
      release();
    });
    // Assert
    await within(screen.getByRole('dialog')).findByText(text.errors.unconfirmed);
  });
});
