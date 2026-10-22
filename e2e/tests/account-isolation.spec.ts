import { randomUUID } from 'node:crypto';

import { type BrowserContext, expect, type Page, test } from '@playwright/test';

import { walletDictionary as text } from '../../apps/web/src/app/routes/wallets/walletDictionary';
import { startBrowserApi } from './support/api-server';
import { createWallet, walletDeletion } from './support/wallet-deletion';

async function register(page: Page, email: string) {
  await page.goto('/register');
  await page.getByRole('textbox', { name: /^name$/i }).fill('Acceptance Investor');
  await page.getByRole('textbox', { name: /email/i }).fill(email);
  await page.getByLabel(/password/i).fill('a-strong-acceptance-test-password');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/wallets$/);
}

test('real sessions isolate multiple wallets, their ledger and every owned mutation', async ({
  page,
  browser,
}) => {
  test.skip(process.env['NODE_ENV'] !== 'test', 'Load the local wallet_test environment.');
  test.setTimeout(120_000);
  const api = await startBrowserApi();
  const { server } = api;
  const ownerEmail = `owner-${randomUUID()}@example.test`;
  const otherEmail = `other-${randomUUID()}@example.test`;
  const emails = [ownerEmail, otherEmail];
  const symbol = `A${randomUUID().replaceAll('-', '').toUpperCase()}`;
  let otherContext: BrowserContext | undefined;
  try {
    otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
    await api.connect(page);
    await register(page, ownerEmail);
    const ownerPath = await createWallet(page, 'Private investment plan');
    const siblingPath = await createWallet(page, 'Keep this investment plan');
    const walletId = ownerPath.split('/').at(-1);
    if (!walletId) {
      throw new Error('Expected the private wallet ID.');
    }
    await server.prisma.instrument.create({
      data: { symbol, name: 'Private owner stock', exchange: 'NASDAQ', quoteCurrency: 'USD' },
    });
    const transaction = await server.prisma.ledgerTransaction.create({
      data: {
        walletId,
        symbol,
        side: 'BUY',
        quantity: '1',
        unitPrice: '10',
        currency: 'USD',
        transactionDate: new Date('2026-01-18'),
      },
    });
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL('/');
    await page.goto(ownerPath);
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('textbox', { name: /email/i }).fill(ownerEmail);
    await page.getByLabel(/password/i).fill('a-strong-acceptance-test-password');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/wallets$/);
    await expect(
      page.getByRole('link', { name: 'Private investment plan', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Keep this investment plan', exact: true }),
    ).toBeVisible();

    const otherPage = await otherContext.newPage();
    await api.connect(otherPage);
    await register(otherPage, otherEmail);
    const otherPath = await createWallet(otherPage, 'Other account plan');
    await otherPage.goto('/wallets');
    await expect(
      otherPage.getByRole('link', { name: 'Other account plan', exact: true }),
    ).toBeVisible();
    await expect(
      otherPage.getByRole('link', { name: 'Private investment plan', exact: true }),
    ).toHaveCount(0);
    await otherPage.goto(ownerPath);
    await expect(otherPage.getByRole('heading', { name: text.detail.unavailable })).toBeVisible();
    await expect(otherPage.getByText('Private owner stock')).toHaveCount(0);

    const rejected = await otherPage.evaluate(
      async ({ walletId, symbol, transactionId }) => {
        const base = `/api/wallets/${walletId}`;
        const requests = [
          { path: base, method: 'GET' },
          { path: `${base}/holdings`, method: 'GET' },
          { path: `${base}/holdings/${symbol}`, method: 'GET' },
          { path: `${base}/transactions`, method: 'GET' },
          { path: `${base}/valuation`, method: 'GET' },
          { path: `${base}/price-refresh`, method: 'GET' },
          { path: `${base}/price-refresh`, method: 'POST' },
          { path: base, method: 'PATCH', body: { name: 'Attempted takeover' } },
          { path: base, method: 'DELETE' },
          { path: `${base}/transactions/${transactionId}`, method: 'DELETE' },
          {
            path: `${base}/transactions`,
            method: 'POST',
            body: {
              symbol,
              side: 'BUY',
              transactionDate: '2026-01-18',
              quantity: '1',
              unitPrice: '10',
              currency: 'USD',
            },
          },
        ];
        return Promise.all(
          requests.map(async ({ path, method, body }) => {
            const response = await fetch(path, {
              method,
              credentials: 'include',
              ...(body
                ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
                : {}),
            });
            return { path, method, status: response.status };
          }),
        );
      },
      { walletId, symbol, transactionId: transaction.id },
    );
    expect(rejected).toHaveLength(11);
    for (const response of rejected) {
      expect(response.status, `${response.method} ${response.path}`).toBe(404);
    }
    expect(await server.prisma.wallet.findUnique({ where: { id: walletId } })).toMatchObject({
      name: 'Private investment plan',
    });
    expect(await server.prisma.ledgerTransaction.count({ where: { walletId } })).toBe(1);

    await page.goto(ownerPath);
    const deletion = walletDeletion(page);
    await deletion.open();
    await deletion.advance();
    await deletion.input.fill('Private investment plan');
    await deletion.submit.click();
    await expect(page).toHaveURL(/\/wallets$/);
    await expect(
      page.getByRole('link', { name: 'Keep this investment plan', exact: true }),
    ).toBeVisible();
    expect(await server.prisma.ledgerTransaction.count({ where: { walletId } })).toBe(0);
    expect(await server.prisma.instrument.findUnique({ where: { symbol } })).not.toBeNull();
    await page.goto(siblingPath);
    await expect(
      page.getByRole('heading', { name: 'Keep this investment plan', exact: true }),
    ).toBeVisible();
    await otherPage.goto(otherPath);
    await expect(
      otherPage.getByRole('heading', { name: 'Other account plan', exact: true }),
    ).toBeVisible();
  } finally {
    try {
      await otherContext?.close();
      if (!page.isClosed()) {
        await page.unrouteAll({ behavior: 'wait' });
      }
    } finally {
      try {
        await server.priceRefresh.stop();
        await server.prisma.user.deleteMany({ where: { email: { in: emails } } });
        await server.prisma.instrument.deleteMany({ where: { symbol } });
      } finally {
        await api.close();
      }
    }
  }
});
