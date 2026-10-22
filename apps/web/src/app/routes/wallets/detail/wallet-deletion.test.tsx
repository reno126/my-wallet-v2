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

import { emptyLedgerHandlers } from '@/test/ledger-api';
import { unavailablePricingHandlers } from '@/test/market-data-api';
import { walletPage, walletSummary } from '@/test/wallet-api';

import { routeObjects } from '../../../router';
import { walletDictionary as text } from '../walletDictionary';

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: mockGetSession, useSession: () => ({ isPending: false }) },
}));
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>();
  return {
    ...original,
    createApiClient: (baseUrl?: string, signal?: AbortSignal) =>
      original.createApiClient(baseUrl ?? 'http://wallet-api.test/api', signal),
  };
});
const endpoint = 'http://wallet-api.test/api/wallets';
const detailPath = `/wallets/${walletSummary.id}`;
const mockApiServer = setupServer(
  ...emptyLedgerHandlers(endpoint),
  ...unavailablePricingHandlers('http://wallet-api.test/api'),
);
let deletes = 0;
beforeAll(() => mockApiServer.listen());
afterAll(() => mockApiServer.close());
afterEach(() => {
  mockApiServer.resetHandlers();
  toast.dismiss();
  vi.restoreAllMocks();
});
beforeEach(() => {
  deletes = 0;
  mockGetSession.mockReset().mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  mockApiServer.use(
    http.get(endpoint, () => HttpResponse.json(walletPage())),
    http.get(`${endpoint}/${walletSummary.id}`, () => HttpResponse.json(walletSummary)),
    http.delete(`${endpoint}/${walletSummary.id}`, () => {
      deletes += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

async function openDeletion() {
  const router = createMemoryRouter(routeObjects, { initialEntries: [detailPath] });
  onTestFinished(() => router.dispose());
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  // The initial lazy route also imports the financial screens on a cold test worker.
  await user.click(
    await screen.findByRole('button', { name: text.delete.open }, { timeout: 5_000 }),
  );
  return {
    router,
    user,
    dialog: () => screen.getByRole('alertdialog'),
    input: () => screen.getByRole('textbox', { name: text.delete.nameLabel }),
    submit: () => user.click(screen.getByRole('button', { name: text.delete.submit })),
    async advance() {
      await user.click(screen.getByRole('button', { name: text.delete.continue }));
      await screen.findByRole('heading', { name: text.delete.finalTitle });
    },
    async confirm() {
      await user.type(
        screen.getByRole('textbox', { name: text.delete.nameLabel }),
        walletSummary.name,
      );
    },
  };
}

describe('when deleting a wallet through its detail route', () => {
  it('should show warnings in order and require an exact name and explicit final submission', async () => {
    // Arrange
    const page = await openDeletion();
    // Assert
    expect(page.dialog()).toHaveAccessibleName(text.delete.firstTitle);
    expect(page.dialog()).toHaveAccessibleDescription(text.delete.firstWarning);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.delete.submit })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.delete.cancel })).toHaveFocus();
    expect(deletes).toBe(0);
    // Act
    await page.advance();
    // Assert
    expect(page.dialog()).toHaveAccessibleName(text.delete.finalTitle);
    expect(page.dialog()).toHaveAccessibleDescription(text.delete.finalWarning);
    expect(screen.getByRole('button', { name: text.delete.submit })).toBeDisabled();
    // Act
    await page.user.type(page.input(), walletSummary.name.toLowerCase());
    // Assert
    expect(page.input()).toBeInvalid();
    expect(screen.getByRole('button', { name: text.delete.submit })).toBeDisabled();
    // Act
    await page.user.clear(page.input());
    await page.user.type(page.input(), ` ${walletSummary.name}`);
    // Assert
    expect(screen.getByRole('button', { name: text.delete.submit })).toBeDisabled();
    // Act
    await page.user.clear(page.input());
    await page.confirm();
    await page.user.keyboard('{Enter}');
    // Assert
    expect(deletes).toBe(0);
    expect(screen.getByRole('button', { name: text.delete.submit })).toBeEnabled();
    // Act
    await page.submit();
    // Assert
    await screen.findByRole('heading', { name: text.empty.title });
    expect(page.router.state.location.pathname).toBe('/wallets');
    expect(await screen.findByText(text.delete.confirmed)).toBeVisible();
    expect(deletes).toBe(1);
  });

  it.each(['first', 'final'] as const)(
    'should cancel at the %s warning and restart without a remembered confirmation',
    async (step) => {
      // Arrange
      const page = await openDeletion();
      if (step === 'final') {
        await page.advance();
        await page.confirm();
      }
      // Act
      await page.user.click(screen.getByRole('button', { name: text.delete.cancel }));
      // Assert
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: text.delete.open })).toHaveFocus();
      expect(deletes).toBe(0);
      expect(page.router.state.location.pathname).toBe(detailPath);
      // Act
      await page.user.click(screen.getByRole('button', { name: text.delete.open }));
      // Assert
      expect(page.dialog()).toHaveAccessibleName(text.delete.firstTitle);
      // Act
      await page.advance();
      // Assert
      expect(page.input()).toHaveValue('');
      expect(screen.getByRole('button', { name: text.delete.submit })).toBeDisabled();
    },
  );

  it('should keep a pending deletion open and prevent duplicate requests', async () => {
    // Arrange
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mockApiServer.use(
      http.delete(`${endpoint}/${walletSummary.id}`, async () => {
        deletes += 1;
        await pending;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const page = await openDeletion();
    await page.advance();
    await page.confirm();
    try {
      // Act
      await page.user.dblClick(screen.getByRole('button', { name: text.delete.submit }));
      // Assert
      await waitFor(() => expect(deletes).toBe(1));
      expect(page.input()).toBeDisabled();
      expect(screen.getByRole('button', { name: text.delete.submitting })).toBeDisabled();
      expect(screen.getByRole('button', { name: text.delete.cancel })).toBeDisabled();
      // Act
      await page.user.keyboard('{Escape}');
      // Assert
      expect(page.dialog()).toBeVisible();
      expect(deletes).toBe(1);
    } finally {
      finish();
    }
    // Assert
    await screen.findByRole('heading', { name: text.empty.title });
  });

  it.each([
    {
      scenario: 'rate limiting',
      response: () => HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } }),
      message: text.errors.retryAfter(30),
    },
    {
      scenario: 'forbidden deletion',
      response: () => HttpResponse.json({}, { status: 403 }),
      message: text.delete.failed,
    },
    {
      scenario: 'server failure',
      response: () => HttpResponse.json({}, { status: 500 }),
      message: text.delete.unconfirmed,
    },
    {
      scenario: 'network failure',
      response: () => HttpResponse.error(),
      message: text.delete.unconfirmed,
    },
  ])(
    'should retain the confirmation after $scenario without claiming success',
    async ({ response, message }) => {
      // Arrange
      const successToast = vi.spyOn(toast, 'success');
      mockApiServer.use(http.delete(`${endpoint}/${walletSummary.id}`, response));
      const page = await openDeletion();
      await page.advance();
      await page.confirm();
      // Act
      await page.submit();
      // Assert
      expect(await within(page.dialog()).findByRole('alert')).toHaveTextContent(message);
      expect(page.input()).toHaveValue(walletSummary.name);
      expect(screen.getByRole('button', { name: text.delete.submit })).toBeEnabled();
      expect(successToast).not.toHaveBeenCalled();
      expect(page.router.state.location.pathname).toBe(detailPath);
    },
  );

  it('should reject a stale name before sending DELETE', async () => {
    // Arrange
    const page = await openDeletion();
    await page.advance();
    await page.confirm();
    mockApiServer.use(
      http.get(`${endpoint}/${walletSummary.id}`, () =>
        HttpResponse.json({ ...walletSummary, name: 'Renamed wallet' }),
      ),
    );
    // Act
    await page.submit();
    // Assert
    expect(await within(page.dialog()).findByRole('alert')).toHaveTextContent(text.delete.invalid);
    expect(within(page.dialog()).getByText('Renamed wallet')).toBeVisible();
    expect(screen.getByRole('button', { name: text.delete.submit })).toBeDisabled();
    expect(deletes).toBe(0);
  });

  it.each(['', 'wrong name', ` ${walletSummary.name}`])(
    'should reject a bypassed confirmation of %j',
    async (confirmationName) => {
      // Arrange
      const page = await openDeletion();
      await page.advance();
      // Act
      await act(() =>
        page.router.navigate(detailPath, {
          formMethod: 'delete',
          formEncType: 'application/json',
          body: { confirmationName },
        }),
      );
      // Assert
      expect(await within(page.dialog()).findByRole('alert')).toBeVisible();
      expect(deletes).toBe(0);
    },
  );
  it('should retry a rejected deletion only after another explicit submit and clear old feedback', async () => {
    // Arrange
    mockApiServer.use(
      http.delete(`${endpoint}/${walletSummary.id}`, () => {
        deletes += 1;
        return deletes === 1
          ? HttpResponse.json({}, { status: 429 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
    const page = await openDeletion();
    await page.advance();
    await page.confirm();
    await page.submit();
    await within(page.dialog()).findByRole('alert');
    // Act
    await page.submit();
    // Assert
    await screen.findByRole('heading', { name: text.empty.title });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(deletes).toBe(2);
  });

  it('should not send DELETE or a late success notice when navigation aborts the name check', async () => {
    // Arrange
    const page = await openDeletion();
    await page.advance();
    await page.confirm();
    let finish: () => void = () => undefined;
    let started: () => void = () => undefined;
    const nameCheck = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const successToast = vi.spyOn(toast, 'success');
    mockApiServer.use(
      http.get(`${endpoint}/${walletSummary.id}`, async () => {
        started();
        await pending;
        return HttpResponse.json(walletSummary);
      }),
    );
    // Act
    await page.submit();
    await nameCheck;
    await act(() => page.router.navigate('/wallets'));
    finish();
    // Assert
    await screen.findByRole('heading', { name: text.empty.title });
    expect(deletes).toBe(0);
    expect(successToast).not.toHaveBeenCalled();
    expect(page.router.state.location.pathname).toBe('/wallets');
  });

  it('should show an unavailable wallet when another client has already deleted it', async () => {
    // Arrange
    const successToast = vi.spyOn(toast, 'success');
    mockApiServer.use(
      http.delete(`${endpoint}/${walletSummary.id}`, () => {
        mockApiServer.use(
          http.get(`${endpoint}/${walletSummary.id}`, () => HttpResponse.json({}, { status: 404 })),
        );
        return HttpResponse.json({}, { status: 404 });
      }),
    );
    const page = await openDeletion();
    await page.advance();
    await page.confirm();
    // Act
    await page.submit();
    // Assert
    expect(await screen.findByRole('heading', { name: text.detail.unavailable })).toBeVisible();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(successToast).not.toHaveBeenCalled();
  });
});
