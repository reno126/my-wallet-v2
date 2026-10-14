import { expect, type Page, test } from '@playwright/test';

import { mockAuthApi } from './support/auth-api';
import { responsiveViewportWidths } from './support/viewports';
import { mockWalletsApi } from './support/wallets-api';

for (const width of responsiveViewportWidths) {
  test(`wallet dashboard and create dialog fit at ${width}px`, async ({ page }) => {
    await mockAuthApi(page, { initiallySignedIn: true });
    await mockWalletsApi(page);
    await page.setViewportSize({ width, height: 900 });

    await page.goto('/wallets');
    await expect(page.getByRole('heading', { name: /wallets/i }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: /new wallet/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /wallet name/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('textbox', { name: /wallet name/i }).fill('Responsive wallet');
    await page.getByRole('button', { name: /^create wallet$/i }).click();
    await expect(page.getByRole('heading', { name: 'Responsive wallet' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const pageWidths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));

  expect(pageWidths.content).toBeLessThanOrEqual(pageWidths.viewport);
}
