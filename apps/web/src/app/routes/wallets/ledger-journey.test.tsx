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
import { unavailablePricingHandlers } from '@/test/market-data-api';
import { walletSummary } from '@/test/wallet-api';

import { appDictionary } from '../../appDictionary';
import { routeObjects } from '../../router';
import { ledgerDictionary as text } from './ledgerDictionary';

const { mockSession } = vi.hoisted(() => ({ mockSession: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: mockSession, useSession: () => ({ isPending: false }) },
}));
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>();
  return {
    ...original,
    createApiClient: (baseUrl?: string, signal?: AbortSignal) =>
      original.createApiClient(baseUrl ?? 'https://ledger.test/api', signal),
  };
});
const endpoint = `https://ledger.test/api/wallets/${walletSummary.id}`;
const path = `/wallets/${walletSummary.id}`;
const server = setupServer(...unavailablePricingHandlers('https://ledger.test/api'));
let holding = { ...ledgerHolding };
let history = structuredClone(ledgerHistory);
const mutations: { method: string; body: unknown }[] = [];
beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  toast.dismiss();
});
beforeEach(() => {
  holding = { ...ledgerHolding };
  history = structuredClone(ledgerHistory);
  mutations.length = 0;
  mockSession.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  server.use(
    http.get(endpoint, () => HttpResponse.json(walletSummary)),
    http.get(`${endpoint}/holdings`, () => HttpResponse.json(walletHoldings([holding]))),
    http.get(`${endpoint}/holdings/:symbol`, () => HttpResponse.json(holding)),
    http.get(`${endpoint}/transactions`, () => HttpResponse.json(history)),
    http.post(`${endpoint}/transactions`, async ({ request }) => {
      mutations.push({ method: 'POST', body: await request.json() });
      holding = { ...holding, quantity: '1', remainingCostBasis: '10', realizedProfitLoss: '7.5' };
      const transaction = {
        ...ledgerHistory.transactions[0],
        id: '5e414ffe-56a1-4c25-9caf-a661474640b8',
        quantity: '0.5',
        unitPrice: '20',
        side: 'SELL',
        walletId: holding.walletId,
        symbol: holding.symbol,
        transactionDate: '2026-01-18',
        currency: 'USD',
        createdAt: '2026-01-19T15:00:03Z',
      };
      return HttpResponse.json(
        {
          transaction,
          holding: {
            walletId: holding.walletId,
            symbol: holding.symbol,
            quantity: '1',
            quoteCurrency: 'USD',
          },
        },
        { status: 201 },
      );
    }),
    http.delete(`${endpoint}/transactions/:transactionId`, async ({ request }) => {
      mutations.push({ method: 'DELETE', body: await request.text() });
      holding = { ...holding, quantity: '2', remainingCostBasis: '20', realizedProfitLoss: '0' };
      history = {
        ...history,
        transactions: history.transactions.slice(1).map((row) => ({ ...row, canDelete: true })),
        pagination: { ...history.pagination, totalCount: 1 },
      };
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

function openPage(suffix = '') {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path + suffix] });
  onTestFinished(() => router.dispose());
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  return {
    router,
    user,
    async sell(symbol = 'AAPL') {
      await user.click(await screen.findByRole('button', { name: text.sell.open(symbol) }));
    },
    async fillSale(quantity = '0.5', price = '20') {
      await user.type(screen.getByRole('textbox', { name: text.sell.quantity }), quantity);
      await user.type(screen.getByRole('textbox', { name: text.sell.price }), price);
    },
    async submitSale() {
      await user.click(screen.getByRole('button', { name: text.sell.submit }));
    },
    async delete() {
      await user.click(
        await screen.findByRole('button', { name: text.delete.open('AAPL', 'SELL') }),
      );
    },
  };
}

describe('when managing the ledger through wallet routes', () => {
  it('should keep instrument filters and deletion eligibility when navigating history pages', async () => {
    // Arrange
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${endpoint}/transactions`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        queries.push(query);
        const page = Number(query.get('page') ?? 1);
        return HttpResponse.json({
          ...ledgerHistory,
          transactions:
            page === 1
              ? ledgerHistory.transactions.slice(0, 1)
              : ledgerHistory.transactions.slice(1),
          pagination: { page, pageSize: 25, totalCount: 26, totalPages: 2 },
        });
      }),
    );
    const page = openPage('/instruments/AAPL');
    // Act
    await page.user.click(await screen.findByRole('link', { name: text.next }, { timeout: 5000 }));
    // Assert
    expect(await screen.findByRole('article', { name: /BUY AAPL/ })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: text.delete.open('AAPL', 'BUY') }),
    ).not.toBeInTheDocument();
    expect(queries.at(-1)?.get('symbol')).toBe('AAPL');
    expect(queries.at(-1)?.get('page')).toBe('2');
    expect(page.router.state.location.search).toBe('?page=2');
  });

  it('should redirect an emptied final history page to the last available page', async () => {
    // Arrange
    server.use(
      http.get(`${endpoint}/transactions`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? 1);
        return HttpResponse.json({
          ...ledgerHistory,
          pagination: { page, pageSize: 25, totalCount: 2, totalPages: 1 },
        });
      }),
    );
    // Act
    const page = openPage('?page=2');
    // Assert
    expect(await screen.findByRole('heading', { name: text.walletSummary })).toBeVisible();
    expect(page.router.state.location.search).toBe('?page=1');
  });

  it('should show accounting and navigate to instrument history without offering older-row deletion', async () => {
    // Arrange
    const page = openPage();
    // Act
    await page.user.click(
      await screen.findByRole('link', { name: text.details('AAPL') }, { timeout: 5000 }),
    );
    // Assert
    expect(await screen.findByRole('heading', { name: /AAPL · Apple Inc\./i })).toBeVisible();
    expect(screen.getByRole('heading', { name: text.positionSummary })).toBeVisible();
    expect(screen.getByRole('article', { name: /BUY AAPL/ })).not.toContainElement(
      screen.getByRole('button', { name: text.delete.open('AAPL', 'SELL') }),
    );
    expect(
      screen.queryByRole('button', { name: text.delete.open('AAPL', 'BUY') }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('Gain: USD 2.50').length).toBeGreaterThan(0);
    expect(page.router.state.location.pathname).toBe(`${path}/instruments/AAPL`);
  });

  it('should validate quantities, prices and dates and preview proceeds before dispatch', async () => {
    // Arrange
    const page = openPage();
    await page.sell();
    // Act
    await page.fillSale('2', '0');
    await page.submitSale();
    // Assert
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toBeInvalid();
    expect(screen.getByRole('textbox', { name: text.sell.price })).toBeInvalid();
    expect(mutations).toHaveLength(0);
    // Act
    await page.user.clear(screen.getByRole('textbox', { name: text.sell.quantity }));
    await page.user.type(screen.getByRole('textbox', { name: text.sell.quantity }), '0.5');
    await page.user.clear(screen.getByRole('textbox', { name: text.sell.price }));
    await page.user.type(screen.getByRole('textbox', { name: text.sell.price }), '20.12345678');
    // Assert
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('USD 10.06');
    expect(mutations).toHaveLength(0);
  });

  it('should submit exact sale values and revalidate the wallet without navigating away', async () => {
    // Arrange
    const page = openPage();
    await page.sell();
    await page.fillSale('0.50000000', '20.12345678');
    // Act
    await page.submitSale();
    // Assert
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      method: 'POST',
      body: {
        side: 'SELL',
        quantity: '0.50000000',
        unitPrice: '20.12345678',
        symbol: 'AAPL',
        currency: 'USD',
      },
    });
    expect((await screen.findAllByText('Gain: USD 7.50')).length).toBeGreaterThan(0);
    expect(page.router.state.location.pathname).toBe(path);
    // Act
    await page.sell();
    // Assert
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('');
    expect(screen.getByRole('button', { name: text.sell.submit })).toBeEnabled();
    expect(mutations).toHaveLength(1);
  });

  it('should preserve sale values when the server rejects chronological overselling', async () => {
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
    const page = openPage('/instruments/AAPL');
    await page.sell();
    await page.fillSale();
    // Act
    await page.submitSale();
    // Assert
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text.errors.insufficient);
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('0.5');
    expect(screen.getByRole('textbox', { name: text.sell.price })).toHaveValue('20');
    expect(screen.getByRole('button', { name: text.sell.submit })).toBeEnabled();
  });

  it.each(['network', 'invalid', 'server'])(
    'should block resubmission after an unconfirmed %s sale outcome',
    async (failure) => {
      // Arrange
      let posts = 0;
      server.use(
        http.post(`${endpoint}/transactions`, () => {
          posts += 1;
          return failure === 'network'
            ? HttpResponse.error()
            : HttpResponse.json({}, { status: failure === 'server' ? 500 : 201 });
        }),
      );
      const page = openPage();
      await page.sell();
      await page.fillSale();
      // Act
      await page.submitSale();
      // Assert
      expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
        text.errors.unconfirmed,
      );
      expect(screen.getByRole('button', { name: text.sell.submit })).toBeDisabled();
      expect(posts).toBe(1);
      // Act
      await page.user.click(screen.getByRole('button', { name: text.cancel }));
      await page.sell();
      // Assert
      expect(screen.getByRole('button', { name: text.sell.submit })).toBeDisabled();
      expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
        text.errors.unconfirmed,
      );
    },
  );

  it.each([
    { view: 'wallet detail', suffix: '' },
    { view: 'instrument detail', suffix: '/instruments/AAPL' },
  ])('should isolate uncertain sales between wallets in $view', async ({ suffix }) => {
    // Arrange
    const secondWallet = {
      ...walletSummary,
      id: '8e414ffe-56a1-4c25-9caf-a661474640b8',
      name: 'Second wallet',
    };
    const secondHolding = { ...ledgerHolding, walletId: secondWallet.id };
    const secondEndpoint = `https://ledger.test/api/wallets/${secondWallet.id}`;
    server.use(
      http.post(`${endpoint}/transactions`, () => HttpResponse.error()),
      http.get(secondEndpoint, () => HttpResponse.json(secondWallet)),
      http.get(`${secondEndpoint}/holdings`, () =>
        HttpResponse.json(walletHoldings([secondHolding], secondWallet.id)),
      ),
      http.get(`${secondEndpoint}/holdings/AAPL`, () => HttpResponse.json(secondHolding)),
      http.get(`${secondEndpoint}/transactions`, () =>
        HttpResponse.json({
          ...ledgerHistory,
          transactions: ledgerHistory.transactions.map((row) => ({
            ...row,
            walletId: secondWallet.id,
          })),
        }),
      ),
    );
    const page = openPage(suffix);
    await page.sell();
    await page.fillSale();
    await page.submitSale();
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      text.errors.unconfirmed,
    );
    // Act
    await page.user.click(screen.getByRole('button', { name: text.cancel }));
    await act(async () => {
      await page.router.navigate(`/wallets/${secondWallet.id}${suffix}`);
    });
    await page.sell();
    // Assert
    expect(screen.getByText(new RegExp(secondWallet.name))).toBeVisible();
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: text.sell.price })).toHaveValue('');
    expect(screen.getByRole('button', { name: text.sell.submit })).toBeEnabled();
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should isolate uncertain sales when navigating to another instrument in the same wallet', async () => {
    // Arrange
    const secondHolding = { ...ledgerHolding, symbol: 'MSFT', name: 'Microsoft' };
    server.use(
      http.post(`${endpoint}/transactions`, () => HttpResponse.error()),
      http.get(`${endpoint}/holdings/MSFT`, () => HttpResponse.json(secondHolding)),
    );
    const page = openPage('/instruments/AAPL');
    await page.sell();
    await page.fillSale();
    await page.submitSale();
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      text.errors.unconfirmed,
    );
    // Act
    await page.user.click(screen.getByRole('button', { name: text.cancel }));
    await act(async () => {
      await page.router.navigate(`${path}/instruments/MSFT`);
    });
    expect(screen.getByRole('heading', { name: /MSFT · Microsoft/ })).toBeVisible();
    await page.sell('MSFT');
    // Assert
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('');
    expect(screen.getByRole('button', { name: text.sell.submit })).toBeEnabled();
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should preserve sale values through a holding refresh and unblock an uncertain outcome without retrying', async () => {
    // Arrange
    let posts = 0;
    server.use(
      http.post(`${endpoint}/transactions`, () => {
        posts += 1;
        return HttpResponse.error();
      }),
    );
    const page = openPage();
    await page.sell();
    await page.fillSale();
    await page.submitSale();
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      text.errors.unconfirmed,
    );
    holding = { ...holding, quantity: '1.25' };
    // Act
    await page.user.click(screen.getByRole('button', { name: text.refresh }));
    // Assert
    await waitFor(() =>
      expect(screen.getByRole('button', { name: text.sell.submit })).toBeEnabled(),
    );
    expect(screen.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('0.5');
    expect(screen.getByRole('textbox', { name: text.sell.price })).toHaveValue('20');
    expect(
      within(screen.getByRole('dialog')).getByText(`${text.sell.available}: 1.25`),
    ).toBeVisible();
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
    expect(posts).toBe(1);
  });

  it('should block repeated deletion after an uncertain outcome until the ledger is refreshed', async () => {
    // Arrange
    let deletes = 0;
    server.use(
      http.delete(`${endpoint}/transactions/:transactionId`, () => {
        deletes += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const page = openPage();
    await page.delete();
    // Act
    await page.user.click(screen.getByRole('button', { name: text.delete.submit }));
    // Assert
    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent(
      text.errors.unconfirmed,
    );
    expect(screen.getByRole('button', { name: text.delete.submit })).toBeDisabled();
    // Act
    await page.user.click(screen.getByRole('button', { name: text.cancel }));
    await page.delete();
    // Assert
    expect(screen.getByRole('button', { name: text.delete.submit })).toBeDisabled();
    // Act
    await page.user.click(screen.getByRole('button', { name: text.refresh }));
    // Assert
    await waitFor(() =>
      expect(screen.getByRole('button', { name: text.delete.submit })).toBeEnabled(),
    );
    expect(within(screen.getByRole('alertdialog')).queryByRole('alert')).not.toBeInTheDocument();
    expect(deletes).toBe(1);
  });

  it('should require deletion confirmation, allow cancellation and revalidate instrument accounting after deletion', async () => {
    // Arrange
    const page = openPage('/instruments/AAPL');
    await page.delete();
    // Assert
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(text.delete.warning);
    expect(mutations).toHaveLength(0);
    // Act
    await page.user.click(screen.getByRole('button', { name: text.cancel }));
    await page.delete();
    await page.user.click(screen.getByRole('button', { name: text.delete.submit }));
    // Assert
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mutations).toEqual([{ method: 'DELETE', body: '' }]);
    expect(screen.getAllByText('USD 20.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: text.delete.open('AAPL', 'BUY') })).toBeVisible();
  });

  it('should retain a stale deletion dialog on conflict and refresh eligibility without retrying', async () => {
    // Arrange
    let deletes = 0;
    server.use(
      http.delete(`${endpoint}/transactions/:transactionId`, () => {
        deletes += 1;
        history = {
          ...history,
          transactions: history.transactions.map((row) => ({ ...row, canDelete: false })),
        };
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'Conflict', requestId: walletSummary.id } },
          { status: 409 },
        );
      }),
    );
    const page = openPage();
    await page.delete();
    // Act
    await page.user.click(screen.getByRole('button', { name: text.delete.submit }));
    // Assert
    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent(
      text.errors.conflict,
    );
    expect(deletes).toBe(1);
    // Act
    await page.user.click(screen.getByRole('button', { name: text.refresh }));
    // Assert
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: text.delete.open('AAPL', 'SELL') }),
    ).not.toBeInTheDocument();
    expect(deletes).toBe(1);
  });

  it('should leave a closed position visible but prevent another sale', async () => {
    // Arrange
    holding = { ...holding, quantity: '0', remainingCostBasis: '0', averageUnitCost: null };
    // Act
    openPage('/instruments/AAPL');
    // Assert
    expect(await screen.findByRole('button', { name: text.sell.open('AAPL') })).toBeDisabled();
    expect(screen.getByText(text.noAverage)).toBeVisible();
    expect(screen.getAllByText('Gain: USD 2.50').length).toBeGreaterThan(0);
  });

  it('should return to the wallet after deleting the last instrument entry', async () => {
    // Arrange
    const only = ledgerHistory.transactions[1];
    if (!only) {
      throw new Error('Missing BUY fixture.');
    }
    history = {
      transactions: [{ ...only, canDelete: true }],
      pagination: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 },
    };
    const page = openPage('/instruments/AAPL');
    await page.user.click(
      await screen.findByRole('button', { name: text.delete.open('AAPL', 'BUY') }),
    );
    // Act
    await page.user.click(screen.getByRole('button', { name: text.delete.submit }));
    // Assert
    await waitFor(() => expect(page.router.state.location.pathname).toBe(path));
    expect(await screen.findByRole('heading', { name: walletSummary.name })).toBeVisible();
  });

  it('should recover a ledger load failure through the shared page boundary', async () => {
    // Arrange
    let fails = true;
    server.use(
      http.get(`${endpoint}/holdings`, () =>
        fails ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json(walletHoldings()),
      ),
    );
    const page = openPage();
    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(text.loadFailed);
    expect(screen.getByRole('navigation', { name: appDictionary.navigation.main })).toBeVisible();
    // Act
    fails = false;
    await page.user.click(screen.getByRole('button', { name: appDictionary.pageErrors.retry }));
    // Assert
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: text.history, level: 2 })).toBeVisible(),
    );
  });

  it('should keep confirmation controls disabled until a pending deletion completes', async () => {
    // Arrange
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete(`${endpoint}/transactions/:id`, async () => {
        await gate;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const page = openPage();
    await page.delete();
    // Act
    await page.user.click(screen.getByRole('button', { name: text.delete.submit }));
    await page.user.keyboard('{Escape}');
    // Assert
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(screen.getByRole('button', { name: text.cancel })).toBeDisabled();
    // Act
    act(() => {
      release();
    });
    // Assert
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
