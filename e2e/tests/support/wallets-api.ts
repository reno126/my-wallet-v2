import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

interface WalletsApiMock {
  readonly createdWallets: readonly { name: string; reportingCurrency: string }[];
  readonly unexpectedRequests: readonly string[];
  readonly deleteRequests: readonly string[];
}

export async function mockWalletsApi(page: Page): Promise<WalletsApiMock> {
  const wallets: Array<{
    id: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    reportingCurrency: string;
  }> = [];
  const createdWallets: Array<{ name: string; reportingCurrency: string }> = [];
  const unexpectedRequests: string[] = [];
  const deleteRequests: string[] = [];

  await page.route('**/api/wallets**', async (route) => {
    const request = route.request();
    const requestPath = new URL(request.url()).pathname;

    if (request.method() === 'GET' && requestPath.endsWith('/holdings')) {
      await route.fulfill({
        json: {
          walletId: requestPath.split('/')[3],
          reportingCurrency: 'USD',
          remainingCostBasis: '0',
          realizedProfitLoss: '0',
          lastTransactionDate: null,
          holdings: [],
        },
      });
      return;
    }
    if (request.method() === 'GET' && requestPath.endsWith('/transactions')) {
      await route.fulfill({
        json: {
          transactions: [],
          pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 },
        },
      });
      return;
    }

    if (requestPath.startsWith('/api/wallets/') && request.method() === 'DELETE') {
      deleteRequests.push(requestPath);
      const walletIndex = wallets.findIndex(
        (wallet) => `/api/wallets/${wallet.id}` === requestPath,
      );
      if (walletIndex === -1) {
        await route.fulfill({ status: 404, json: {} });
      } else {
        wallets.splice(walletIndex, 1);
        await route.fulfill({ status: 204 });
      }
      return;
    }

    if (requestPath.startsWith('/api/wallets/') && request.method() === 'GET') {
      const wallet = wallets.find((candidate) => `/api/wallets/${candidate.id}` === requestPath);
      await route.fulfill(wallet ? { json: wallet } : { status: 404, json: {} });
      return;
    }

    if (requestPath !== '/api/wallets') {
      await route.continue();
      return;
    }

    if (request.method() === 'GET') {
      await route.fulfill({
        json: {
          wallets,
          pagination: {
            page: Number(new URL(request.url()).searchParams.get('page') ?? 1),
            pageSize: 25,
            totalCount: wallets.length,
            totalPages: wallets.length === 0 ? 0 : 1,
          },
        },
      });
      return;
    }

    if (request.method() === 'POST') {
      const input: unknown = request.postDataJSON();

      if (!isWalletCreateRequest(input)) {
        await route.fulfill({ status: 400, json: { message: 'Invalid wallet request.' } });
        return;
      }

      const now = '2026-01-15T12:00:00.000Z';
      const wallet = {
        id: randomUUID(),
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
        createdAt: now,
        updatedAt: now,
        reportingCurrency: input.reportingCurrency,
      };

      wallets.unshift(wallet);
      createdWallets.push({ name: input.name, reportingCurrency: input.reportingCurrency });
      await route.fulfill({ status: 201, json: wallet });
      return;
    }

    unexpectedRequests.push(`${request.method()} ${requestPath}`);
    await route.fulfill({ status: 404, json: { message: 'Unexpected wallet request.' } });
  });

  return {
    get deleteRequests() {
      return [...deleteRequests];
    },
    get createdWallets() {
      return [...createdWallets];
    },
    get unexpectedRequests() {
      return [...unexpectedRequests];
    },
  };
}

function isWalletCreateRequest(
  value: unknown,
): value is { name: string; description?: string; reportingCurrency: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const request = value;

  return (
    'name' in request &&
    typeof request.name === 'string' &&
    'reportingCurrency' in request &&
    typeof request.reportingCurrency === 'string' &&
    (!('description' in request) || typeof request.description === 'string')
  );
}
