import { expect, test } from '@playwright/test';

import { purchaseDictionary as text } from '../../apps/web/src/app/routes/wallets/buy/purchaseDictionary';
import { historicalPrice, stock } from '../../apps/web/src/test/purchase-api';
import { mockAuthApi } from './support/auth-api';
import { responsiveViewportWidths } from './support/viewports';
import { mockWalletsApi } from './support/wallets-api';

for (const width of responsiveViewportWidths) {
  test(`purchase search, validation, and quote states fit at ${width}px`, async ({ page }) => {
    await mockAuthApi(page, { initiallySignedIn: true });
    await mockWalletsApi(page);
    await page.setViewportSize({ width, height: 900 });
    let failPrice = true;
    let emptySearch = false;
    let releaseSearch: () => void = () => {};
    let releasePrice: () => void = () => {};
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const priceGate = new Promise<void>((resolve) => {
      releasePrice = resolve;
    });
    const name = 'VeryLongCompanyNameWithoutSpaces'.repeat(5);
    await page.route('**/api/instruments/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/search')) {
        await searchGate;
        await route.fulfill({
          json: { results: emptySearch ? [] : [{ ...stock, name }], excluded: [] },
        });
      } else {
        await priceGate;
        await route.fulfill(
          failPrice
            ? {
                status: 503,
                json: {
                  error: {
                    code: 'PROVIDER_QUOTA_EXHAUSTED',
                    message: 'Quota',
                    requestId: 'b7e967c0-0b21-46f1-8c60-89e19bb2f840',
                  },
                },
              }
            : { json: historicalPrice },
        );
      }
    });
    async function expectNoOverflow() {
      const bounds = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(bounds.content).toBeLessThanOrEqual(bounds.viewport);
    }
    await page.goto('/wallets/new');
    await page.getByRole('textbox', { name: /wallet name/i }).fill('Purchase plan');
    await page.getByRole('button', { name: /^create wallet$/i }).click();
    await page.getByRole('link', { name: text.title }).click();
    const search = page.getByRole('textbox', { name: text.searchLabel });
    await page.getByRole('button', { name: text.search, exact: true }).click();
    await expect(search).toHaveAttribute('aria-invalid', 'true');
    await expectNoOverflow();
    await search.fill(stock.symbol);
    await search.press('Enter');
    await expect(page.getByRole('button', { name: text.searching })).toBeDisabled();
    await expectNoOverflow();
    releaseSearch();
    const result = page.getByRole('button', { name: text.select(stock.symbol) });
    await expect(result).toBeVisible();
    await expectNoOverflow();
    await page.getByLabel(text.date, { exact: true }).fill(historicalPrice.requestedDate);
    await result.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(text.loadingPrice)).toBeVisible();
    await expectNoOverflow();
    releasePrice();
    await expect(page.getByText(text.errors.quota, { exact: true }).first()).toBeVisible();
    await expectNoOverflow();
    failPrice = false;
    await page.getByRole('button', { name: text.retryPrice }).click();
    await expect(page.getByText(text.fallback)).toBeVisible();
    await expect(page.getByText(text.exactPrice(historicalPrice.unitPrice))).toBeVisible();
    const save = page.getByRole('button', { name: text.submit, exact: true });
    await save.click();
    await expect(page.getByRole('textbox', { name: text.quantity, exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expectNoOverflow();
    if (width === 375 || width === 1440)
      await page.screenshot({ path: test.info().outputPath('purchase-quote.png'), fullPage: true });
    emptySearch = true;
    await search.fill('UNKNOWN');
    await search.press('Enter');
    await expect(page.getByText(text.empty, { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    await expectNoOverflow();
  });
}
