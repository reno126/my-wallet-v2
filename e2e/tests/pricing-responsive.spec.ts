import { expect, test } from '@playwright/test';

import { ledgerDictionary } from '../../apps/web/src/app/routes/wallets/ledgerDictionary';
import {
  pricingDictionary as text,
  quotaRemaining,
} from '../../apps/web/src/app/routes/wallets/pricingDictionary';
import { ledgerHistory, ledgerHolding, walletHoldings } from '../../apps/web/src/test/ledger-api';
import {
  priceValuation,
  providerQuota,
  refreshStatus,
} from '../../apps/web/src/test/market-data-api';
import { walletSummary } from '../../apps/web/src/test/wallet-api';
import { mockAuthApi } from './support/auth-api';
import { responsiveViewportWidths } from './support/viewports';

test.use({ locale: 'en-US', timezoneId: 'Europe/Warsaw' });

for (const width of responsiveViewportWidths) {
  test(`cached values, final-budget refresh and asset freshness fit at ${width}px`, async ({
    page,
  }) => {
    // Arrange
    await page.setViewportSize({ width, height: 900 });
    await mockAuthApi(page, { initiallySignedIn: true });
    let fresh = false;
    let completed = false;
    let running = false;
    let refreshes = 0;
    const path = `/wallets/${walletSummary.id}`;
    await page.route('**/api/market-data/quota', (route) =>
      route.fulfill({
        json: {
          ...providerQuota,
          used: running ? 250 : 249,
          remaining: running ? 0 : 1,
          exhausted: running,
        },
      }),
    );
    await page.route('**/api/wallets/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname.endsWith('/price-refresh')) {
        refreshes += 1;
        running = true;
        await route.fulfill({
          status: 202,
          json: { walletId: walletSummary.id, requestedSymbols: ['AAPL'] },
        });
      } else if (pathname.endsWith('/valuation')) {
        await route.fulfill({ json: priceValuation(fresh ? 'fresh' : 'stale') });
      } else if (pathname.endsWith('/price-refresh')) {
        if (fresh) {
          completed = true;
        }
        const status = refreshStatus(fresh ? 'fresh' : 'stale');
        await route.fulfill({
          json: {
            ...status,
            hasPendingWork: running && !completed,
            holdings: status.holdings.map((holding) => ({
              ...holding,
              status: running && !completed ? 'running' : 'succeeded',
            })),
          },
        });
      } else if (pathname.endsWith('/holdings/AAPL')) {
        await route.fulfill({ json: ledgerHolding });
      } else if (pathname.endsWith('/holdings')) {
        await route.fulfill({ json: walletHoldings() });
      } else if (pathname.endsWith('/transactions')) {
        await route.fulfill({ json: ledgerHistory });
      } else {
        await route.fulfill({ json: walletSummary });
      }
    });
    async function noOverflow() {
      const bounds = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(bounds.content).toBeLessThanOrEqual(bounds.viewport);
    }
    // Act
    await page.goto(path);
    const panel = page.getByRole('region', { name: text.title });
    const quota = page.getByRole('complementary', { name: text.quota.title });
    // Assert
    await expect(page.getByRole('heading', { name: walletSummary.name })).toBeVisible();
    await expect(panel.getByText(text.freshness.stale, { exact: true })).toBeVisible();
    await expect(panel.getByText(text.running)).toBeVisible();
    await expect(panel.getByText('USD 30.00', { exact: true })).toBeVisible();
    await expect(quota.getByText(quotaRemaining(0, 250))).toBeVisible();
    await expect(quota.getByText('1/20/2026, 12:00:00 AM', { exact: true })).toBeVisible();
    await noOverflow();
    await page.screenshot({ path: test.info().outputPath('stale-wallet.png'), fullPage: true });
    // Act
    fresh = true;
    // Assert
    await expect(panel.getByText(text.freshness.fresh)).toBeVisible();
    expect(refreshes).toBe(1);
    await noOverflow();
    // Act
    await page.getByRole('link', { name: ledgerDictionary.details('AAPL'), exact: true }).click();
    // Assert
    await expect(panel.getByText('USD 20.0000', { exact: true })).toBeVisible();
    await expect(panel.getByText('2026-01-16', { exact: true })).toBeVisible();
    await expect(panel.getByText('100.00%', { exact: true })).toHaveCount(2);
    await expect(quota.getByText(text.exhausted)).toBeVisible();
    expect(refreshes).toBe(1);
    await noOverflow();
    await page.screenshot({ path: test.info().outputPath('fresh-asset.png'), fullPage: true });
    // Act
    fresh = false;
    await panel.getByRole('button', { name: text.retry, exact: true }).click();
    // Assert
    await expect(panel.getByText(text.freshness.stale, { exact: true })).toBeVisible();
    await expect(panel.getByText(text.exhausted)).toBeVisible();
    await expect(panel.getByText('USD 30.00', { exact: true })).toBeVisible();
    expect(refreshes).toBe(1);
    await noOverflow();
    await page.screenshot({ path: test.info().outputPath('exhausted-asset.png'), fullPage: true });
  });
}

test('missing and unavailable prices leave ledger actions available and quota errors can recover', async ({
  page,
}) => {
  // Arrange
  await page.setViewportSize({ width: 320, height: 900 });
  await mockAuthApi(page, { initiallySignedIn: true });
  let failed = true;
  await page.route('**/api/market-data/quota', (route) =>
    route.fulfill(
      failed ? { status: 503, json: {} } : { json: { ...providerQuota, configured: false } },
    ),
  );
  await page.route('**/api/wallets/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/valuation')) {
      return route.fulfill(
        failed ? { status: 503, json: {} } : { json: priceValuation('missing') },
      );
    }
    if (pathname.endsWith('/price-refresh')) {
      return route.fulfill({ json: { ...refreshStatus('missing'), providerConfigured: false } });
    }
    if (pathname.endsWith('/holdings')) {
      return route.fulfill({ json: walletHoldings() });
    }
    if (pathname.endsWith('/transactions')) {
      return route.fulfill({ json: ledgerHistory });
    }
    return route.fulfill({ json: walletSummary });
  });
  // Act
  await page.goto(`/wallets/${walletSummary.id}`);
  const panel = page.getByRole('region', { name: text.title });
  const quota = page.getByRole('complementary', { name: text.quota.title });
  // Assert
  await expect(panel.getByText(text.unavailable).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: ledgerDictionary.sell.open('AAPL'), exact: true }),
  ).toBeVisible();
  await expect(quota.getByText(text.quota.unavailable)).toBeVisible();
  // Act
  failed = false;
  await quota.getByRole('button', { name: text.retry, exact: true }).click();
  await panel.getByRole('button', { name: text.retry, exact: true }).click();
  // Assert
  await expect(quota.getByText(text.quota.disabled)).toBeVisible();
  await expect(panel.getByText(text.freshness.missing)).toBeVisible();
  await expect(panel.getByText('USD 0.00', { exact: true })).toHaveCount(0);
});
