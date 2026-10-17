import { expect, type Locator, type Page, test } from '@playwright/test';

import { walletDictionary } from '../../apps/web/src/app/routes/wallets/walletDictionary';
import { mockAuthApi } from './support/auth-api';
import { responsiveViewportWidths } from './support/viewports';
import { mockWalletsApi } from './support/wallets-api';

for (const width of responsiveViewportWidths) {
  test(`wallet list, create, and detail pages fit at ${width}px`, async ({ page }) => {
    await mockAuthApi(page, { initiallySignedIn: true });
    await mockWalletsApi(page);
    await page.setViewportSize({ width, height: 900 });

    await page.goto('/wallets');
    await expect(page.getByRole('heading', { name: /wallets/i }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('link', { name: /new wallet/i }).click();
    await expect(page.getByRole('textbox', { name: /wallet name/i })).toBeVisible();
    await expect(page.getByText(walletDictionary.create.currencyNote, { exact: true })).toHaveCSS(
      'font-size',
      '14px',
    );
    const descriptionColor = await page
      .getByText(walletDictionary.create.description, { exact: true })
      .evaluate((element) => getComputedStyle(element).color);
    await expect(page.getByText(walletDictionary.create.currencyNote, { exact: true })).toHaveCSS(
      'color',
      descriptionColor,
    );
    await expectNoHorizontalOverflow(page);
    if (width === 375 || width === 1440) {
      await page.screenshot({ path: test.info().outputPath('wallet-create.png'), fullPage: true });
    }

    const walletName = 'W'.repeat(100);
    const walletDescription = 'D'.repeat(500);
    await page.getByRole('textbox', { name: /wallet name/i }).fill(walletName);
    await page.getByRole('textbox', { name: /description/i }).fill(walletDescription);
    await page.getByRole('button', { name: /^create wallet$/i }).click();
    await expect(page.getByRole('heading', { name: walletName })).toBeVisible();
    await expect(page.getByText(walletDictionary.detail.title, { exact: true })).toHaveCSS(
      'font-size',
      '14px',
    );
    const metadataColor = await page
      .getByText(walletDictionary.wallet.created, { exact: true })
      .evaluate((element) => getComputedStyle(element).color);
    await expect(page.getByText(walletDictionary.detail.title, { exact: true })).toHaveCSS(
      'color',
      metadataColor,
    );
    await expectTextToFit(page.getByRole('heading', { name: walletName }));
    await expectTextToFit(page.getByText(walletDescription, { exact: true }));
    await expectNoHorizontalOverflow(page);
    if (width === 375 || width === 1440) {
      await page.screenshot({ path: test.info().outputPath('wallet-detail.png'), fullPage: true });
    }
    await page.getByRole('link', { name: /back to wallets/i }).click();
    await expect(page.getByRole('link', { name: walletName })).toBeVisible();
    await expectTextToFit(page.getByRole('heading', { name: walletName }));
    await expectTextToFit(page.getByText(walletDescription, { exact: true }));
    await expectNoHorizontalOverflow(page);
  });
}

async function expectTextToFit(locator: Locator) {
  const bounds = await locator.evaluate((element) => ({
    content: element.scrollWidth,
    width: element.clientWidth,
    right: element.getBoundingClientRect().right,
    viewport: window.innerWidth,
  }));
  expect(bounds.content).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
}

async function expectNoHorizontalOverflow(page: Page) {
  const pageWidths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));

  expect(pageWidths.content).toBeLessThanOrEqual(pageWidths.viewport);
}
