import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterContextProvider, RouterProvider } from 'react-router';
import { toast } from 'sonner';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { walletPage, walletSummary } from '@/test/wallet-api';

import { appDictionary } from '../../appDictionary';
import { routeObjects } from '../../router';
import { purchaseDictionary } from './buy/purchaseDictionary';
import { createWalletAction } from './create/CreateWalletModule';
import { walletDictionary as text } from './walletDictionary';

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: mockGetSession, useSession: () => ({ isPending: false }) },
}));
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>();
  return {
    ...original,
    createApiClient: (baseUrl?: string, signal?: AbortSignal) =>
      original.createApiClient(baseUrl ?? 'https://wallet-api.test/api', signal),
  };
});
const endpoint = 'https://wallet-api.test/api/wallets';
const mockApiServer = setupServer();
beforeAll(() => mockApiServer.listen());
afterEach(() => {
  mockApiServer.resetHandlers();
  toast.dismiss();
  vi.restoreAllMocks();
});
afterAll(() => mockApiServer.close());
beforeEach(() => {
  mockGetSession.mockReset().mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  mockApiServer.use(
    http.get(endpoint, () => HttpResponse.json(walletPage())),
    http.get(`${endpoint}/${walletSummary.id}`, () => HttpResponse.json(walletSummary)),
    http.post(endpoint, () => HttpResponse.json(walletSummary, { status: 201 })),
  );
});

function openWalletPage(path = '/wallets') {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  return {
    router,
    user,
    nameInput: () => screen.getByRole('textbox', { name: text.create.name }),
    descriptionInput: () => screen.getByRole('textbox', { name: text.create.descriptionLabel }),
    async fillForm() {
      await screen.findByRole('heading', { name: text.create.title });
      await user.type(screen.getByRole('textbox', { name: text.create.name }), walletSummary.name);
      await user.type(
        screen.getByRole('textbox', { name: text.create.descriptionLabel }),
        walletSummary.description ?? '',
      );
    },
    async submit() {
      await user.click(screen.getByRole('button', { name: text.create.submit }));
    },
  };
}

function createGate() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('wallet routes and creation', () => {
  it.each([
    { suffix: '', heading: walletSummary.name },
    { suffix: '/buy', heading: purchaseDictionary.title },
  ])(
    'should preserve private navigation and recover a failed wallet read at $suffix',
    async ({ suffix, heading }) => {
      // Arrange
      let reads = 0;
      mockApiServer.use(
        http.get(`${endpoint}/${walletSummary.id}`, () => {
          reads += 1;
          return reads === 1
            ? HttpResponse.json({}, { status: 503 })
            : HttpResponse.json(walletSummary);
        }),
      );
      const page = openWalletPage(`/wallets/${walletSummary.id}${suffix}`);
      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent(text.detail.loadFailed);
      expect(screen.getByRole('navigation', { name: appDictionary.navigation.main })).toBeVisible();
      // Act
      await page.user.click(screen.getByRole('button', { name: text.page.retry }));
      // Assert
      expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
      expect(reads).toBe(2);
    },
  );

  it('should reject invalid wallet response data through the shared page boundary', async () => {
    // Arrange
    mockApiServer.use(
      http.get(`${endpoint}/${walletSummary.id}`, () =>
        HttpResponse.json({ name: 'Unvalidated server detail' }),
      ),
    );
    // Act
    openWalletPage(`/wallets/${walletSummary.id}`);
    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(text.detail.loadFailed);
    expect(screen.queryByText('Unvalidated server detail')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: appDictionary.navigation.main })).toBeVisible();
  });

  it('should open the dedicated create page from an empty dashboard and block invalid input', async () => {
    // Arrange
    let posts = 0;
    mockApiServer.use(
      http.post(endpoint, () => {
        posts += 1;
        return HttpResponse.json(walletSummary);
      }),
    );
    const page = openWalletPage();
    await screen.findByRole('heading', { name: text.empty.title });
    // Act
    await page.user.click(screen.getByRole('link', { name: text.page.createButton }));
    await screen.findByRole('heading', { name: text.create.title });
    await page.submit();
    // Assert
    expect(page.router.state.location.pathname).toBe('/wallets/new');
    expect(page.nameInput()).toBeInvalid();
    expect(page.nameInput()).toHaveAccessibleDescription();
    expect(posts).toBe(0);
  });

  it('should post once without a session pre-check and redirect to the created wallet', async () => {
    // Arrange
    let posts = 0;
    let sessionChecksAtPost = 0;
    let requestBody: unknown;
    const gate = createGate();
    mockApiServer.use(
      http.post(endpoint, async ({ request }) => {
        posts += 1;
        sessionChecksAtPost = mockGetSession.mock.calls.length;
        requestBody = await request.json();
        await gate.promise;
        return HttpResponse.json(walletSummary, { status: 201 });
      }),
    );
    const page = openWalletPage('/wallets/new');
    await page.fillForm();
    const sessionChecksBeforeSubmit = mockGetSession.mock.calls.length;
    // Act
    await page.submit();
    await waitFor(() => expect(posts).toBe(1));
    const submitButton = screen.getByRole('button', { name: text.create.submitting });
    expect(submitButton).toBeDisabled();
    await page.user.click(submitButton);
    gate.resolve();
    // Assert
    expect(await screen.findByRole('heading', { name: walletSummary.name })).toBeVisible();
    expect(page.router.state.location.pathname).toBe(`/wallets/${walletSummary.id}`);
    expect(await screen.findByText(text.create.confirmed)).toBeVisible();
    expect(posts).toBe(1);
    expect(sessionChecksAtPost).toBe(sessionChecksBeforeSubmit);
    expect(requestBody).toStrictEqual({
      name: walletSummary.name,
      description: walletSummary.description,
      reportingCurrency: 'USD',
    });
  });

  it('should create a wallet when the optional description is left blank', async () => {
    // Arrange
    let requestBody: unknown;
    const wallet = { ...walletSummary, description: '' };
    mockApiServer.use(
      http.post(endpoint, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json(wallet, { status: 201 });
      }),
      http.get(`${endpoint}/${wallet.id}`, () => HttpResponse.json(wallet)),
    );
    const page = openWalletPage('/wallets/new');
    await screen.findByRole('heading', { name: text.create.title });
    expect(page.descriptionInput()).not.toBeRequired();
    // Act
    await page.user.type(page.nameInput(), wallet.name);
    await page.submit();
    // Assert
    expect(await screen.findByRole('heading', { name: wallet.name })).toBeVisible();
    expect(page.router.state.location.pathname).toBe(`/wallets/${wallet.id}`);
    expect(requestBody).toStrictEqual({
      name: wallet.name,
      description: '',
      reportingCurrency: 'USD',
    });
  });

  it('should redirect a POST 401 to login even when the form was opened with a valid session', async () => {
    // Arrange
    let posts = 0;
    mockApiServer.use(
      http.post(endpoint, () => {
        posts += 1;
        return HttpResponse.json({}, { status: 401 });
      }),
    );
    const page = openWalletPage('/wallets/new');
    await page.fillForm();
    mockGetSession.mockResolvedValue({ data: null, error: null });
    // Act
    await page.submit();
    // Assert
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeVisible();
    expect(page.router.state.location.pathname).toBe('/login');
    expect(posts).toBe(1);
  });

  it.each([
    [
      'rate limit',
      () => HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } }),
      text.errors.retryAfter(30),
    ],
    [
      'malformed response',
      () => HttpResponse.json({ id: 'invalid' }, { status: 201 }),
      text.create.unconfirmed,
    ],
    ['network failure', () => HttpResponse.error(), text.create.unconfirmed],
    ['server failure', () => HttpResponse.json({}, { status: 503 }), text.create.unconfirmed],
    ['forbidden', () => HttpResponse.json({}, { status: 403 }), text.create.failed],
  ])('should retain form values after %s', async (_scenario, response, message) => {
    // Arrange
    mockApiServer.use(http.post(endpoint, response));
    const page = openWalletPage('/wallets/new');
    await page.fillForm();
    // Act
    await page.submit();
    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(page.nameInput()).toHaveValue(walletSummary.name);
    expect(page.descriptionInput()).toHaveValue(walletSummary.description);
    expect(screen.getByRole('button', { name: text.create.submit })).toBeEnabled();
    expect(page.router.state.location.pathname).toBe('/wallets/new');
  });

  it('should clear previous failure feedback when a deliberate retry succeeds', async () => {
    // Arrange
    let posts = 0;
    mockApiServer.use(
      http.post(endpoint, () => {
        posts += 1;
        return posts === 1
          ? HttpResponse.json({}, { status: 429 })
          : HttpResponse.json(walletSummary, { status: 201 });
      }),
    );
    const page = openWalletPage('/wallets/new');
    await page.fillForm();
    await page.submit();
    await screen.findByRole('alert');
    // Act
    await page.submit();
    // Assert
    expect(await screen.findByRole('heading', { name: walletSummary.name })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(posts).toBe(2);
  });

  it.each([
    { name: '   ' },
    { name: 'N'.repeat(101) },
    { name: walletSummary.name, description: 'D'.repeat(501) },
    { name: walletSummary.name, description: null },
    { name: walletSummary.name, description: 42 },
    null,
  ])('should reject invalid JSON input %j when client validation is bypassed', async (body) => {
    // Arrange
    let posts = 0;
    mockApiServer.use(
      http.post(endpoint, () => {
        posts += 1;
        return HttpResponse.json(walletSummary);
      }),
    );
    const page = openWalletPage('/wallets/new');
    await page.fillForm();
    // Act
    await act(() =>
      page.router.navigate('/wallets/new', {
        formMethod: 'post',
        formEncType: 'application/json',
        body,
      }),
    );
    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(text.create.invalid);
    expect(posts).toBe(0);
  });

  it.each([undefined, ''])(
    'should preserve an optional description of %j in JSON',
    async (description) => {
      // Arrange
      let requestBody: unknown;
      mockApiServer.use(
        http.post(endpoint, async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json(walletSummary, { status: 201 });
        }),
      );
      const page = openWalletPage('/wallets/new');
      await screen.findByRole('heading', { name: text.create.title });
      // Act
      await act(() =>
        page.router.navigate('/wallets/new', {
          formMethod: 'post',
          formEncType: 'application/json',
          body: { name: walletSummary.name, description },
        }),
      );
      // Assert
      expect(await screen.findByRole('heading', { name: walletSummary.name })).toBeVisible();
      expect(requestBody).toStrictEqual({
        name: walletSummary.name,
        reportingCurrency: 'USD',
        ...(description === undefined ? {} : { description }),
      });
    },
  );

  it('should accept maximum name and description lengths when browser validation is bypassed', async () => {
    // Arrange
    const body = { name: 'N'.repeat(100), description: 'D'.repeat(500) };
    let requestBody: unknown;
    mockApiServer.use(
      http.post(endpoint, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json(walletSummary, { status: 201 });
      }),
    );
    const page = openWalletPage('/wallets/new');
    await screen.findByRole('heading', { name: text.create.title });
    // Act
    await act(() =>
      page.router.navigate('/wallets/new', {
        formMethod: 'post',
        formEncType: 'application/json',
        body,
      }),
    );
    // Assert
    expect(await screen.findByRole('heading', { name: walletSummary.name })).toBeVisible();
    expect(requestBody).toStrictEqual({ ...body, reportingCurrency: 'USD' });
  });

  it('should reject malformed JSON without sending an API request', async () => {
    // Arrange
    let posts = 0;
    mockApiServer.use(
      http.post(endpoint, () => {
        posts += 1;
        return HttpResponse.json(walletSummary);
      }),
    );
    const url = new URL('https://wallet-app.test/wallets/new');
    const request = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    // Act
    const result = await createWalletAction({
      request,
      url,
      pattern: '/wallets/new',
      params: {},
      context: new RouterContextProvider(),
    });
    // Assert
    expect(result).toStrictEqual({ error: text.create.invalid });
    expect(posts).toBe(0);
  });

  it('should reject an invalid detail identifier before sending a wallet request', async () => {
    // Arrange
    const page = openWalletPage('/wallets/invalid');
    // Assert
    expect(await screen.findByRole('heading', { name: text.detail.unavailable })).toBeVisible();
    expect(page.router.state.location.pathname).toBe('/wallets/invalid');
  });

  it('should report successful creation separately from a failed detail read', async () => {
    // Arrange
    mockApiServer.use(
      http.get(`${endpoint}/${walletSummary.id}`, () => HttpResponse.json({}, { status: 500 })),
    );
    const page = openWalletPage('/wallets/new');
    await page.fillForm();
    // Act
    await page.submit();
    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(text.detail.loadFailed);
    expect(await screen.findByText(text.create.confirmed)).toBeVisible();
    expect(screen.queryByText(text.create.failed)).not.toBeInTheDocument();
    expect(page.router.state.location.pathname).toBe(`/wallets/${walletSummary.id}`);
  });

  it('should abort a pending creation when navigating away without a late toast or redirect', async () => {
    // Arrange
    const gate = createGate();
    const requestStarted = createGate();
    const responseReleased = createGate();
    const successToast = vi.spyOn(toast, 'success');
    const fetchRequest = vi.spyOn(globalThis, 'fetch');
    mockApiServer.use(
      http.post(endpoint, async () => {
        requestStarted.resolve();
        await gate.promise;
        responseReleased.resolve();
        return HttpResponse.json(walletSummary, { status: 201 });
      }),
    );
    const page = openWalletPage('/wallets/new');
    await page.fillForm();
    try {
      // Act
      await page.submit();
      await requestStarted.promise;
      const submittedRequest = fetchRequest.mock.calls
        .map(([input]) => input)
        .find((input) => input instanceof Request && input.method === 'POST');
      await page.user.click(screen.getByRole('link', { name: /^wallets$/i }));
      // Assert
      expect(await screen.findByRole('heading', { name: text.empty.title })).toBeVisible();
      await waitFor(() => expect(submittedRequest).toMatchObject({ signal: { aborted: true } }));
    } finally {
      gate.resolve();
    }
    await act(() => responseReleased.promise);
    expect(page.router.state.location.pathname).toBe('/wallets');
    expect(successToast).not.toHaveBeenCalled();
    expect(screen.queryByText(text.create.confirmed)).not.toBeInTheDocument();
  });

  it('should keep unsaved form input mounted when navigation is interrupted', async () => {
    // Arrange
    const gate = createGate();
    mockApiServer.use(
      http.get(endpoint, async () => {
        await gate.promise;
        return HttpResponse.json(walletPage());
      }),
    );
    const page = openWalletPage('/wallets/new');
    await page.fillForm();
    // Act
    await page.user.click(screen.getByRole('link', { name: /^wallets$/i }));
    // Assert
    expect(page.nameInput()).toHaveValue(walletSummary.name);
    // Act
    await act(() => page.router.navigate('/wallets/new'));
    gate.resolve();
    // Assert
    expect(page.nameInput()).toHaveValue(walletSummary.name);
  });

  it.each([403, 404])(
    'should show an unavailable wallet for status %s without redirecting to login',
    async (status) => {
      // Arrange
      mockApiServer.use(
        http.get(`${endpoint}/${walletSummary.id}`, () => HttpResponse.json({}, { status })),
      );
      const page = openWalletPage(`/wallets/${walletSummary.id}`);
      // Assert
      expect(await screen.findByRole('heading', { name: text.detail.unavailable })).toBeVisible();
      expect(page.router.state.location.pathname).toBe(`/wallets/${walletSummary.id}`);
    },
  );

  it('should redirect a protected read 401 to login', async () => {
    // Arrange
    mockApiServer.use(
      http.get(endpoint, () => {
        mockGetSession.mockResolvedValue({ data: null, error: null });
        return HttpResponse.json({}, { status: 401 });
      }),
    );
    const page = openWalletPage();
    // Assert
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeVisible();
    expect(page.router.state.location.pathname).toBe('/login');
  });

  it('should reload the wallet list when the user retries a failed read', async () => {
    // Arrange
    let reads = 0;
    mockApiServer.use(
      http.get(endpoint, () => {
        reads += 1;
        return reads === 1
          ? HttpResponse.json({}, { status: 500 })
          : HttpResponse.json(walletPage([walletSummary]));
      }),
    );
    const page = openWalletPage();
    await screen.findByRole('alert');
    // Act
    await page.user.click(screen.getByRole('button', { name: text.page.retry }));
    // Assert
    expect(await screen.findByRole('heading', { name: walletSummary.name })).toBeVisible();
    expect(reads).toBe(2);
  });

  it.each(['?page=0', '?page=abc', '?page=1&page=2'])(
    'should canonicalize an invalid pagination query %s',
    async (query) => {
      // Arrange
      const page = openWalletPage(`/wallets${query}`);
      // Assert
      await screen.findByRole('heading', { name: text.empty.title });
      expect(page.router.state.location.search).toBe('');
    },
  );

  it('should paginate using the shared page size and open a wallet from its card', async () => {
    // Arrange
    mockApiServer.use(
      http.get(endpoint, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        return HttpResponse.json(
          walletPage([{ ...walletSummary, name: `Wallet ${page}` }], page, 26),
        );
      }),
    );
    const page = openWalletPage();
    await screen.findByRole('heading', { name: 'Wallet 1' });
    // Act
    await page.user.click(screen.getByRole('button', { name: text.page.nextPage }));
    // Assert
    expect(await screen.findByRole('heading', { name: 'Wallet 2' })).toBeVisible();
    expect(page.router.state.location.search).toBe('?page=2');
    // Act
    await page.user.click(screen.getByRole('link', { name: 'Wallet 2' }));
    // Assert
    expect(await screen.findByRole('heading', { name: walletSummary.name })).toBeVisible();
  });
});
