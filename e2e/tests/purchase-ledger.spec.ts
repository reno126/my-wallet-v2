import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import type {} from '../../apps/api/src/plugins/fmp';
import type {} from '../../apps/api/src/plugins/prisma';
import { purchaseDictionary as text } from '../../apps/web/src/app/routes/wallets/buy/purchaseDictionary';
import { ledgerDictionary as ledgerText } from '../../apps/web/src/app/routes/wallets/ledgerDictionary';
import {
  pricingDictionary as pricingText,
  quotaRemaining,
} from '../../apps/web/src/app/routes/wallets/pricingDictionary';
import { historicalPrice, purchaseInput } from '../../apps/web/src/test/purchase-api';
import { startBrowserApi } from './support/api-server';

test('a browser buy, sell, delete and corrected re-entry persist exact FIFO results in PostgreSQL', async ({
  page,
}) => {
  test.skip(
    process.env['NODE_ENV'] !== 'test',
    'Load the dedicated test environment to run the PostgreSQL browser journey.',
  );
  test.setTimeout(90_000);
  const { createTestProviderBudget } = await import('../../apps/api/test-support/provider-budget');
  const email = `browser-${randomUUID()}@example.test`;
  const symbol = `E${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const providerRequests: string[] = [];
  const budget = createTestProviderBudget(5);
  let releaseQuote = () => {};
  const quoteGate = new Promise<void>((resolve) => {
    releaseQuote = resolve;
  });
  const api = await startBrowserApi({
    budget,
    timeoutMs: 30_000,
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      providerRequests.push(url.pathname);
      if (url.pathname.endsWith('/quote')) {
        await quoteGate;
        return Response.json([{ symbol, price: 250, timestamp: Math.floor(Date.now() / 1000) }]);
      }
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
      return Response.json(body);
    },
  });
  const { server } = api;
  try {
    await api.connect(page);
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
    const pricing = page.getByRole('region', { name: pricingText.title });
    await expect(pricing.getByText(pricingText.freshness.missing, { exact: true })).toBeVisible();
    await expect(pricing.getByText(pricingText.running)).toBeVisible();
    expect(budget.used()).toBe(5);
    expect(providerRequests).toEqual([
      '/stable/search-symbol',
      '/stable/historical-price-eod/full',
      '/stable/profile',
      '/stable/profile',
      '/stable/quote',
    ]);
    releaseQuote();
    await expect(pricing.getByText(pricingText.freshness.fresh, { exact: true })).toBeVisible();
    await expect(page.getByText(quotaRemaining(0, 5), { exact: true })).toBeVisible();
    const snapshot = await server.prisma.priceSnapshot.findFirstOrThrow({ where: { symbol } });
    expect(snapshot.unitPrice.toFixed()).toBe('250');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Purchase browser journey', exact: true }),
    ).toBeVisible();
    expect(await server.prisma.ledgerTransaction.count({ where: { symbol } })).toBe(1);
    const earlier = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await server.prisma.priceSnapshot.updateMany({
      where: { symbol },
      data: { retrievedAt: earlier, marketDate: new Date(earlier.toISOString().slice(0, 10)) },
    });
    await page.reload();
    await expect(pricing.getByText(pricingText.freshness.stale, { exact: true })).toBeVisible();
    await expect(pricing.getByText('USD 308.64', { exact: true })).toBeVisible();
    await expect(pricing.getByText(pricingText.exhausted)).toBeVisible();
    expect(budget.used()).toBe(5);
    expect(providerRequests).toHaveLength(5);
    await page.setViewportSize({ width: 375, height: 900 });
    const bounds = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.viewport);
    await page.screenshot({
      path: test.info().outputPath('database-stale-wallet-phone.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: test.info().outputPath('database-stale-wallet-desktop.png'),
      fullPage: true,
    });

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
    expect(budget.used()).toBe(5);
    await page.reload();
    await expect(page.getByText('Gain: USD 4.94', { exact: true }).first()).toBeVisible();
  } finally {
    releaseQuote();
    try {
      if (!page.isClosed()) {
        await page.unrouteAll({ behavior: 'wait' });
      }
    } finally {
      try {
        if (server.hasDecorator('prisma')) {
          if (server.hasDecorator('priceRefresh')) {
            await server.priceRefresh.stop();
          }
          await server.prisma.user.deleteMany({ where: { email } });
          await server.prisma.refreshWork.deleteMany({ where: { symbol } });
          await server.prisma.priceSnapshot.deleteMany({ where: { symbol } });
          await server.prisma.instrument.deleteMany({ where: { symbol } });
        }
      } finally {
        await api.close();
      }
    }
  }
});
