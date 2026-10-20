import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import type {} from '../../apps/api/src/plugins/prisma';
import { purchaseDictionary as text } from '../../apps/web/src/app/routes/wallets/buy/purchaseDictionary';
import { ledgerDictionary as ledgerText } from '../../apps/web/src/app/routes/wallets/ledgerDictionary';
import { historicalPrice, purchaseInput } from '../../apps/web/src/test/purchase-api';

test('a browser buy, sell, delete and corrected re-entry persist exact FIFO results in PostgreSQL', async ({
  page,
}) => {
  test.skip(
    process.env['NODE_ENV'] !== 'test',
    'Load the dedicated test environment to run the PostgreSQL browser journey.',
  );
  test.setTimeout(90_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('The purchase journey requires an explicit local wallet_test DATABASE_URL.');
  }
  const target = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/wallet_test') {
    throw new Error('The purchase journey may only use the local wallet_test database.');
  }
  const { createTestServer } = await import('../../apps/api/test-support/create-test-server');
  const email = `browser-${randomUUID()}@example.test`;
  const symbol = `E${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const providerRequests: string[] = [];
  let reserved = 0;
  const server = createTestServer(
    {
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_URL: 'http://127.0.0.1:5173',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      FMP_API_KEY: 'browser-test-only-provider-key',
      FMP_BASE_URL: 'http://127.0.0.1/stable/',
    },
    {
      fmp: {
        reserveRequest: () => {
          reserved += 1;
          return Promise.resolve(true);
        },
        fetch: (input) => {
          const url = new URL(input instanceof Request ? input.url : input);
          providerRequests.push(url.pathname);
          const profile = {
            symbol,
            name: 'Browser test stock',
            companyName: 'Browser test stock',
            currency: 'USD',
            exchange: 'NASDAQ',
            isEtf: false,
            isFund: false,
            ipoDate: '2000-01-01',
          };
          const body = url.pathname.endsWith('/historical-price-eod/full')
            ? [{ symbol, date: historicalPrice.effectiveDate, close: historicalPrice.unitPrice }]
            : [profile];
          return Promise.resolve(Response.json(body));
        },
      },
    },
  );
  try {
    await server.ready();
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      async (route) => {
        const request = route.request();
        const method = request.method();
        if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
          throw new Error(`Unexpected browser method: ${method}`);
        }
        const url = new URL(request.url());
        const result = await server.inject({
          method,
          url: url.pathname + url.search,
          headers: await request.allHeaders(),
          ...(request.postData() === null ? {} : { payload: request.postData() ?? '' }),
        });
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(result.headers)) {
          if (value !== undefined) {
            headers[name] = Array.isArray(value) ? value.join('\n') : String(value);
          }
        }
        await route.fulfill({ status: result.statusCode, headers, body: result.body });
      },
    );
    await page.goto('/register');
    await page.getByRole('textbox', { name: /^name$/i }).fill('Browser Investor');
    await page.getByRole('textbox', { name: /email/i }).fill(email);
    await page.getByLabel(/password/i).fill('a-strong-browser-test-password');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/wallets$/);
    await page.getByRole('link', { name: /new wallet/i }).click();
    await page.getByRole('textbox', { name: /wallet name/i }).fill('Purchase browser journey');
    await page.getByRole('button', { name: /^create wallet$/i }).click();
    await page.getByRole('link', { name: text.title }).click();
    await page.getByRole('textbox', { name: text.searchLabel }).fill(symbol);
    await page.getByRole('button', { name: text.search }).click();
    await page.getByLabel(text.date, { exact: true }).fill(historicalPrice.requestedDate);
    const selection = page.getByRole('button', { name: text.select(symbol) });
    await selection.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(text.fallback)).toBeVisible();
    await expect(page.getByText(text.exactPrice(historicalPrice.unitPrice))).toBeVisible();
    await page
      .getByRole('textbox', { name: text.quantity, exact: true })
      .fill(purchaseInput.quantity);
    await page
      .getByRole('textbox', { name: text.descriptionLabel })
      .fill(purchaseInput.description ?? '');
    await page.getByRole('button', { name: text.submit, exact: true }).click();
    await expect(page).toHaveURL(/\/wallets\/[0-9a-f-]{36}$/);
    await expect(page.getByText(text.confirmed)).toBeVisible();
    const transactions = await server.prisma.ledgerTransaction.findMany({ where: { symbol } });
    expect(transactions).toHaveLength(1);
    const saved = transactions[0];
    expect(saved?.transactionDate.toISOString().slice(0, 10)).toBe(purchaseInput.transactionDate);
    expect(saved?.quantity.toFixed()).toBe(purchaseInput.quantity);
    expect(saved?.unitPrice.toFixed()).toBe(purchaseInput.unitPrice);
    expect(saved?.description).toBe(purchaseInput.description);
    expect(saved?.currency).toBe('USD');
    expect(reserved).toBe(4);
    expect(providerRequests).toEqual([
      '/stable/search-symbol',
      '/stable/profile',
      '/stable/historical-price-eod/full',
      '/stable/profile',
    ]);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Purchase browser journey', exact: true }),
    ).toBeVisible();
    expect(await server.prisma.ledgerTransaction.count({ where: { symbol } })).toBe(1);

    await page.getByRole('link', { name: ledgerText.details(symbol), exact: true }).click();
    await expect(page.getByRole('heading', { name: ledgerText.positionSummary })).toBeVisible();
    async function sell(quantity: string, price: string) {
      await page.getByRole('button', { name: ledgerText.sell.open(symbol), exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: ledgerText.sell.quantity }).fill(quantity);
      await dialog.getByRole('textbox', { name: ledgerText.sell.price }).fill(price);
      await dialog.getByLabel(ledgerText.sell.date, { exact: true }).fill('2026-01-19');
      await dialog.getByRole('button', { name: ledgerText.sell.submit, exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    await sell('1', '250');
    await expect(page.getByText('0.234568', { exact: true })).toBeVisible();
    await expect(page.getByText('Gain: USD 19.88', { exact: true }).first()).toBeVisible();
    const sale = await server.prisma.ledgerTransaction.findFirstOrThrow({
      where: { symbol, side: 'SELL' },
    });
    await page
      .getByRole('button', { name: ledgerText.delete.open(symbol, 'SELL'), exact: true })
      .click();
    await expect(page.getByRole('alertdialog')).toHaveAccessibleDescription(
      ledgerText.delete.warning,
    );
    await page.getByRole('button', { name: ledgerText.cancel, exact: true }).click();
    expect(await server.prisma.ledgerTransaction.count({ where: { symbol } })).toBe(2);
    await page
      .getByRole('button', { name: ledgerText.delete.open(symbol, 'SELL'), exact: true })
      .click();
    await page.getByRole('button', { name: ledgerText.delete.submit, exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText('1.234568', { exact: true }).first()).toBeVisible();
    expect(await server.prisma.ledgerTransaction.findUnique({ where: { id: sale.id } })).toBeNull();
    await sell('0.5', '240');
    await expect(page.getByText('0.734568', { exact: true })).toBeVisible();
    await expect(page.getByText('Gain: USD 4.94', { exact: true }).first()).toBeVisible();
    const replacement = await server.prisma.ledgerTransaction.findFirstOrThrow({
      where: { symbol, side: 'SELL' },
    });
    expect(replacement.id).not.toBe(sale.id);
    expect(replacement.quantity.toFixed()).toBe('0.5');
    expect(replacement.unitPrice.toFixed()).toBe('240');
    expect(reserved).toBe(4);
    await page.reload();
    await expect(page.getByText('Gain: USD 4.94', { exact: true }).first()).toBeVisible();
  } finally {
    try {
      if (!page.isClosed()) {
        await page.unrouteAll({ behavior: 'wait' });
      }
    } finally {
      try {
        if (server.hasDecorator('prisma')) {
          await server.prisma.user.deleteMany({ where: { email } });
          await server.prisma.instrument.deleteMany({ where: { symbol } });
        }
      } finally {
        await server.close();
      }
    }
  }
});
