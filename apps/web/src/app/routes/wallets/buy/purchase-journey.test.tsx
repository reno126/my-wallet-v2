import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterContextProvider, RouterProvider } from 'react-router';
import { toast } from 'sonner';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { historicalPrice, purchaseInput, purchaseResult, stock } from '@/test/purchase-api';
import { walletSummary } from '@/test/wallet-api';

import { routeObjects } from '../../../router';
import { buyPurchaseAction } from './BuyPurchaseModule';
import { purchaseDictionary as text } from './purchaseDictionary';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession, useSession: () => ({ isPending: false }) },
}));
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>();
  return { ...original, apiClient: original.createApiClient('https://wallet-api.test/api') };
});
const endpoint = 'https://wallet-api.test/api';
const transactionEndpoint = `${endpoint}/wallets/${walletSummary.id}/transactions`;
const mockApiServer = setupServer();
beforeAll(() => mockApiServer.listen());
afterAll(() => mockApiServer.close());
afterEach(() => {
  mockApiServer.resetHandlers();
  toast.dismiss();
  vi.restoreAllMocks();
});
beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  mockApiServer.use(
    http.get(`${endpoint}/wallets/${walletSummary.id}`, () => HttpResponse.json(walletSummary)),
    http.get(`${endpoint}/instruments/search`, () =>
      HttpResponse.json({ results: [stock], excluded: [] }),
    ),
    http.get(`${endpoint}/instruments/:symbol/price`, ({ request, params }) => {
      const date = new URL(request.url).searchParams.get('date');
      return HttpResponse.json({
        ...historicalPrice,
        symbol: params['symbol'],
        requestedDate: date,
      });
    }),
    http.post(transactionEndpoint, () => HttpResponse.json(purchaseResult(), { status: 201 })),
  );
});

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function openPurchase() {
  const router = createMemoryRouter(routeObjects, {
    initialEntries: [`/wallets/${walletSummary.id}/buy`],
  });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: text.title });
  const page = {
    router,
    user,
    date: () => screen.getByLabelText(text.date),
    quantity: () => screen.getByRole('textbox', { name: text.quantity }),
    submit: () => screen.getByRole('button', { name: text.submit }),
    async search() {
      await user.type(screen.getByRole('textbox', { name: text.searchLabel }), stock.symbol);
      await user.click(screen.getByRole('button', { name: text.search }));
      await screen.findByRole('button', { name: text.select(stock.symbol) });
    },
    async select() {
      fireEvent.change(this.date(), { target: { value: historicalPrice.requestedDate } });
      await user.click(screen.getByRole('button', { name: text.select(stock.symbol) }));
      await screen.findByText(text.exactPrice(historicalPrice.unitPrice));
    },
  };
  return page;
}

describe('when recording a purchase', () => {
  it.each([
    { date: '', message: text.invalidDate },
    { date: '9999-12-31', message: text.futureDate },
  ])(
    'should explain an invalid trade date ($date) without requesting or retaining a quote',
    async ({ date, message }) => {
      // Arrange
      let priceRequests = 0;
      mockApiServer.use(
        http.get(`${endpoint}/instruments/:symbol/price`, () => {
          priceRequests += 1;
          return HttpResponse.json(historicalPrice);
        }),
      );
      const page = await openPurchase();
      await page.search();
      await page.select();
      // Act
      fireEvent.change(page.date(), { target: { value: date } });
      fireEvent.blur(page.date());
      // Assert
      expect(await screen.findByText(message)).toBeVisible();
      expect(page.date()).toBeInvalid();
      expect(page.date()).toHaveAccessibleDescription();
      expect(page.submit()).toBeDisabled();
      expect(
        screen.queryByText(text.exactPrice(historicalPrice.unitPrice)),
      ).not.toBeInTheDocument();
      expect(priceRequests).toBe(1);
    },
  );

  it('should retain a company-name search after a provider failure and allow retry', async () => {
    // Arrange
    const queries: URLSearchParams[] = [];
    mockApiServer.use(
      http.get(`${endpoint}/instruments/search`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return queries.length === 1
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } })
          : HttpResponse.json({ results: [stock], excluded: [] });
      }),
    );
    const page = await openPurchase();
    // Act
    await page.user.click(screen.getByText(text.company));
    await page.user.type(screen.getByRole('textbox', { name: text.searchLabel }), 'Apple');
    await page.user.click(screen.getByRole('button', { name: text.search }));
    // Assert
    expect(await screen.findByText(text.errors.retryAfter(30))).toBeVisible();
    expect(screen.getByRole('textbox', { name: text.searchLabel })).toHaveValue('Apple');
    expect(queries[0]?.get('mode')).toBe('name');
    // Act
    await page.user.click(screen.getByRole('button', { name: text.search }));
    // Assert
    expect(await screen.findByRole('button', { name: text.select(stock.symbol) })).toBeEnabled();
  });

  it.each([
    { symbol: 'MSFT' },
    { requestedDate: '2026-01-17' },
    { effectiveDate: '2026-01-19' },
    { usedPreviousTradingDay: false },
  ])('should prevent a purchase when the quote does not match its request: %j', async (changes) => {
    // Arrange
    mockApiServer.use(
      http.get(`${endpoint}/instruments/:symbol/price`, () =>
        HttpResponse.json({ ...historicalPrice, ...changes }),
      ),
    );
    const page = await openPurchase();
    await page.search();
    fireEvent.change(page.date(), { target: { value: historicalPrice.requestedDate } });
    // Act
    await page.user.click(screen.getByRole('button', { name: text.select(stock.symbol) }));
    // Assert
    expect(await screen.findByText(text.errors.price)).toBeVisible();
    expect(page.submit()).toBeDisabled();
    expect(screen.queryByText(text.exactPrice(historicalPrice.unitPrice))).not.toBeInTheDocument();
  });

  it('should retain the trade date and full precision, block invalid quantity, and prevent duplicate submission', async () => {
    // Arrange
    const saveGate = gate();
    const posts: unknown[] = [];
    mockApiServer.use(
      http.post(transactionEndpoint, async ({ request }) => {
        posts.push(await request.json());
        await saveGate.promise;
        return HttpResponse.json(purchaseResult(), { status: 201 });
      }),
    );
    const page = await openPurchase();
    expect(page.submit()).toBeDisabled();
    await page.search();
    await page.select();
    // Act
    await page.user.click(page.submit());
    // Assert
    expect(page.quantity()).toBeInvalid();
    expect(page.quantity()).toHaveAccessibleDescription();
    expect(posts).toHaveLength(0);
    // Act
    await page.user.type(page.quantity(), purchaseInput.quantity);
    await page.user.type(
      screen.getByRole('textbox', { name: text.descriptionLabel }),
      purchaseInput.description ?? '',
    );
    await page.user.click(page.submit());
    await waitFor(() => expect(posts).toHaveLength(1));
    const pending = screen.getByRole('button', { name: text.submitting });
    expect(pending).toBeDisabled();
    await page.user.click(pending);
    saveGate.resolve();
    // Assert
    expect(await screen.findByRole('heading', { name: walletSummary.name })).toBeVisible();
    expect(posts).toStrictEqual([purchaseInput]);
    expect(await screen.findByText(text.confirmed)).toBeVisible();
    expect(page.router.state.location.pathname).toBe(`/wallets/${walletSummary.id}`);
  });

  it('should discard a delayed quote when the date changes and keep only the latest quote', async () => {
    // Arrange
    const oldQuote = gate();
    let firstStarted = false;
    mockApiServer.use(
      http.get(`${endpoint}/instruments/:symbol/price`, async ({ request }) => {
        const date = new URL(request.url).searchParams.get('date');
        if (date === historicalPrice.requestedDate) {
          firstStarted = true;
          await oldQuote.promise;
          return HttpResponse.json(historicalPrice);
        }
        return HttpResponse.json({
          ...historicalPrice,
          requestedDate: date,
          effectiveDate: date,
          unitPrice: '240.5',
          usedPreviousTradingDay: false,
        });
      }),
    );
    const page = await openPurchase();
    await page.search();
    fireEvent.change(page.date(), { target: { value: historicalPrice.requestedDate } });
    await page.user.click(screen.getByRole('button', { name: text.select(stock.symbol) }));
    await waitFor(() => expect(firstStarted).toBe(true));
    expect(page.submit()).toBeDisabled();
    // Act
    fireEvent.change(page.date(), { target: { value: '2026-01-20' } });
    await screen.findByText(text.exactPrice('240.5'));
    await act(async () => {
      oldQuote.resolve();
      await oldQuote.promise;
    });
    // Assert
    expect(screen.queryByText(text.exactPrice(historicalPrice.unitPrice))).not.toBeInTheDocument();
    expect(page.submit()).toBeEnabled();
    // Act
    fireEvent.change(page.date(), { target: { value: '' } });
    // Assert
    expect(page.submit()).toBeDisabled();
    expect(screen.queryByText(text.exactPrice('240.5'))).not.toBeInTheDocument();
  });

  it('should hide delayed search results after the query changes and invalidate the selected price', async () => {
    // Arrange
    const searchGate = gate();
    let searches = 0;
    mockApiServer.use(
      http.get(`${endpoint}/instruments/search`, async () => {
        searches += 1;
        if (searches === 1) {
          await searchGate.promise;
        }
        return HttpResponse.json({ results: [stock], excluded: [] });
      }),
    );
    const page = await openPurchase();
    const input = screen.getByRole('textbox', { name: text.searchLabel });
    await page.user.type(input, stock.symbol);
    await page.user.click(screen.getByRole('button', { name: text.search }));
    await waitFor(() => expect(searches).toBe(1));
    // Act
    await page.user.type(input, 'X');
    await act(async () => {
      searchGate.resolve();
      await searchGate.promise;
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: text.searching })).not.toBeInTheDocument(),
    );
    // Assert
    expect(
      screen.queryByRole('button', { name: text.select(stock.symbol) }),
    ).not.toBeInTheDocument();
    // Act
    await page.user.clear(input);
    await page.search();
    await page.select();
    await page.user.type(input, 'X');
    // Assert
    expect(page.submit()).toBeDisabled();
    expect(screen.queryByText(text.exactPrice(historicalPrice.unitPrice))).not.toBeInTheDocument();
  });

  it.each([
    ['PRICE_NOT_AVAILABLE', 404, text.errors.noPrice],
    ['PRICE_LOOKUP_INCOMPLETE', 422, text.errors.incomplete],
    ['PROVIDER_QUOTA_EXHAUSTED', 503, text.errors.quota],
    ['UNSUPPORTED_CURRENCY', 422, text.errors.currency],
    ['PROVIDER_UNAVAILABLE', 503, text.errors.provider],
  ])('should explain %s and allow an explicit price retry', async (code, status, message) => {
    // Arrange
    let fail = true;
    mockApiServer.use(
      http.get(`${endpoint}/instruments/:symbol/price`, () =>
        fail
          ? HttpResponse.json(
              { error: { code, message: 'Internal provider detail', requestId: walletSummary.id } },
              { status },
            )
          : HttpResponse.json(historicalPrice),
      ),
    );
    const page = await openPurchase();
    await page.search();
    fireEvent.change(page.date(), { target: { value: historicalPrice.requestedDate } });
    // Act
    await page.user.click(screen.getByRole('button', { name: text.select(stock.symbol) }));
    // Assert
    expect(await screen.findByText(message)).toBeVisible();
    expect(page.submit()).toBeDisabled();
    expect(screen.queryByText('Internal provider detail')).not.toBeInTheDocument();
    // Act
    fail = false;
    await page.user.click(screen.getByRole('button', { name: text.retryPrice }));
    // Assert
    expect(await screen.findByText(text.exactPrice(historicalPrice.unitPrice))).toBeVisible();
    expect(page.submit()).toBeEnabled();
  });

  it('should show empty and excluded search results without allowing a purchase', async () => {
    // Arrange
    mockApiServer.use(
      http.get(`${endpoint}/instruments/search`, () =>
        HttpResponse.json({
          results: [],
          excluded: [{ symbol: 'BMW.DE', quoteCurrency: 'EUR', reason: 'NON_USD' }],
        }),
      ),
    );
    const page = await openPurchase();
    // Act
    await page.user.click(screen.getByRole('button', { name: text.search }));
    // Assert
    expect(screen.getByRole('textbox', { name: text.searchLabel })).toBeInvalid();
    // Act
    await page.user.type(screen.getByRole('textbox', { name: text.searchLabel }), 'BMW');
    await page.user.click(screen.getByRole('button', { name: text.search }));
    // Assert
    expect(await screen.findByText(text.empty)).toBeVisible();
    expect(screen.getByRole('listitem')).toHaveTextContent(`BMW.DE: ${text.excluded.NON_USD}`);
    expect(page.submit()).toBeDisabled();
  });

  it.each([429, 503])('should retain entered values after a rejected save (%s)', async (status) => {
    // Arrange
    mockApiServer.use(
      http.post(transactionEndpoint, () =>
        HttpResponse.json({}, { status, headers: { 'Retry-After': '30' } }),
      ),
    );
    const page = await openPurchase();
    await page.search();
    await page.select();
    await page.user.type(page.quantity(), purchaseInput.quantity);
    // Act
    await page.user.click(page.submit());
    // Assert
    const expected = status === 429 ? text.errors.retryAfter(30) : text.errors.unconfirmed;
    expect(await screen.findByText(expected)).toBeVisible();
    expect(page.quantity()).toHaveValue(purchaseInput.quantity);
    if (status === 429) {
      expect(page.submit()).toBeEnabled();
    } else {
      await waitFor(() => expect(page.submit()).toBeDisabled());
    }
  });

  it('should redirect expired sessions from a lookup to login', async () => {
    // Arrange
    const page = await openPurchase();
    getSession.mockResolvedValue({ data: null, error: null });
    mockApiServer.use(
      http.get(`${endpoint}/instruments/search`, () => HttpResponse.json({}, { status: 401 })),
    );
    // Act
    await page.user.type(screen.getByRole('textbox', { name: text.searchLabel }), stock.symbol);
    await page.user.click(screen.getByRole('button', { name: text.search }));
    // Assert
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeVisible();
    expect(page.router.state.location.pathname).toBe('/login');
  });

  it('should reject malformed action data before calling the transaction endpoint', async () => {
    // Arrange
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // Act
    const result = await buyPurchaseAction({
      request: new Request('https://web.test/buy', {
        method: 'POST',
        body: JSON.stringify({ ...purchaseInput, unitPrice: 1 }),
      }),
      params: { walletId: walletSummary.id },
      url: new URL('https://web.test/buy'),
      pattern: '/wallets/:walletId/buy',
      context: new RouterContextProvider(),
    });
    // Assert
    expect(result).toMatchObject({
      data: { error: text.invalid, unconfirmed: false },
      init: { status: 400 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
