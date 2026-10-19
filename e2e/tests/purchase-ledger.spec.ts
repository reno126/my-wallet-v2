import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import type {} from '../../apps/api/src/plugins/prisma';
import { purchaseDictionary as text } from '../../apps/web/src/app/routes/wallets/buy/purchaseDictionary';
import { historicalPrice, purchaseInput } from '../../apps/web/src/test/purchase-api';

test('a browser purchase persists the original date and exact decimals in PostgreSQL', async ({
  page,
}) => {
  test.skip(
    process.env['NODE_ENV'] !== 'test',
    'Load the dedicated test environment to run the PostgreSQL browser journey.',
  );
  test.setTimeout(60_000);
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
