import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from '@/components/ui/sonner';
import type { WalletList, WalletSummary } from '@/lib/api/wallets';

import { WalletsLoadingState } from './_components/WalletsLoadingState';
import { walletDictionary } from './_utils/walletDictionary';
import { walletsAction, walletsLoader } from './_utils/walletRouteData';
import { WalletsRoute } from './WalletsRoute';

const { mockListWallets, mockCreateWallet } = vi.hoisted(() => ({
  mockListWallets: vi.fn(),
  mockCreateWallet: vi.fn(),
}));

vi.mock('@/lib/api/wallets', () => ({
  walletsApi: {
    list: mockListWallets,
    create: mockCreateWallet,
  },
}));

describe('wallet dashboard', () => {
  beforeEach(() => {
    mockListWallets.mockReset().mockResolvedValue({ ok: true, value: emptyWalletList() });
    mockCreateWallet.mockReset();
  });

  it('shows the empty state and validates a wallet before submitting', async () => {
    const user = userEvent.setup();
    setupWalletsPage();

    expect(
      await screen.findByRole('heading', { name: walletDictionary.empty.title }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: walletDictionary.page.createButton }));

    const nameInput = screen.getByRole('textbox', { name: walletDictionary.create.name });
    await user.click(screen.getByRole('button', { name: walletDictionary.create.submit }));

    expect(nameInput).toBeInvalid();
    expect(mockCreateWallet).not.toHaveBeenCalled();
  });

  it('creates a wallet, closes the form, and refreshes the wallet cards', async () => {
    const user = userEvent.setup();
    const wallet = createWalletSummary('Long-term');
    let hasWallet = false;
    mockListWallets.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        value: hasWallet ? walletListWith(wallet) : emptyWalletList(),
      }),
    );
    mockCreateWallet.mockImplementation(() => {
      hasWallet = true;
      return Promise.resolve({ ok: true, value: wallet });
    });
    setupWalletsPage();

    await screen.findByRole('heading', { name: walletDictionary.page.title });
    await user.click(screen.getByRole('button', { name: walletDictionary.page.createButton }));
    await user.type(
      screen.getByRole('textbox', { name: walletDictionary.create.name }),
      wallet.name,
    );
    await user.type(
      screen.getByRole('textbox', { name: walletDictionary.create.descriptionLabel }),
      'Retirement plan',
    );
    await user.click(screen.getByRole('button', { name: walletDictionary.create.submit }));

    expect(await screen.findByRole('heading', { name: wallet.name })).toBeVisible();
    expect(await screen.findByText(walletDictionary.create.created(wallet.name))).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockCreateWallet).toHaveBeenCalledWith({
      name: wallet.name,
      description: 'Retirement plan',
      reportingCurrency: 'USD',
    });
  });

  it('keeps the form open and reports an error when creation fails', async () => {
    const user = userEvent.setup();
    mockCreateWallet.mockResolvedValue({ ok: false });
    setupWalletsPage();

    await screen.findByRole('heading', { name: walletDictionary.page.title });
    await user.click(screen.getByRole('button', { name: walletDictionary.page.createButton }));
    await user.type(
      screen.getByRole('textbox', { name: walletDictionary.create.name }),
      'Long-term',
    );
    await user.click(screen.getByRole('button', { name: walletDictionary.create.submit }));

    expect(await screen.findAllByText(walletDictionary.create.failed)).not.toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('shows a retry action when wallets cannot be loaded', async () => {
    const user = userEvent.setup();
    mockListWallets
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, value: walletListWith(createWalletSummary('Core')) });
    setupWalletsPage();

    expect(await screen.findByText(walletDictionary.page.loadFailed)).toBeVisible();
    await user.click(screen.getByRole('button', { name: walletDictionary.page.retry }));

    expect(await screen.findByRole('heading', { name: 'Core' })).toBeVisible();
    expect(mockListWallets).toHaveBeenCalledTimes(2);
  });

  it('changes pages using the route query and preserves pagination state', async () => {
    const user = userEvent.setup();
    mockListWallets.mockImplementation(({ page }: { page: number }) =>
      Promise.resolve({
        ok: true,
        value: {
          ...walletListWith(createWalletSummary(`Wallet ${page}`)),
          pagination: { page, pageSize: 25, totalCount: 26, totalPages: 2 },
        },
      }),
    );
    const { getLocationSearch } = setupWalletsPage();

    await screen.findByRole('heading', { name: 'Wallet 1' });
    await user.click(screen.getByRole('button', { name: walletDictionary.page.nextPage }));

    expect(await screen.findByRole('heading', { name: 'Wallet 2' })).toBeVisible();
    expect(getLocationSearch()).toBe('?page=2');
  });
});

function setupWalletsPage() {
  const router = createMemoryRouter(
    [
      {
        path: '/wallets',
        Component: WalletsRoute,
        loader: walletsLoader,
        action: walletsAction,
        HydrateFallback: WalletsLoadingState,
      },
    ],
    { initialEntries: ['/wallets'] },
  );

  render(
    <>
      <RouterProvider router={router} />
      <Toaster position="top-right" />
    </>,
  );

  return { getLocationSearch: () => router.state.location.search };
}

function emptyWalletList(): WalletList {
  return {
    wallets: [],
    pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 },
  };
}

function walletListWith(wallet: WalletSummary): WalletList {
  return {
    wallets: [wallet],
    pagination: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 },
  };
}

function createWalletSummary(name: string): WalletSummary {
  return {
    id: 'b7e967c0-0b21-46f1-8c60-89e19bb2f840',
    name,
    description: 'Retirement plan',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    reportingCurrency: 'USD',
  };
}
