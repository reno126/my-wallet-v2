import { expect, test } from '@playwright/test';

import { appDictionary } from '../../apps/web/src/app/appDictionary';
import { walletDictionary } from '../../apps/web/src/app/routes/wallets/walletDictionary';
import { walletSummary } from '../../apps/web/src/test/wallet-api';
import { mockAuthApi } from './support/auth-api';
import { mockWalletsApi } from './support/wallets-api';

for (const width of [320, 1440]) {
  test(`page failures retain navigation and allow recovery at ${width}px`, async ({ page }) => {
    // Arrange
    await mockAuthApi(page, { initiallySignedIn: true });
    const wallets = await mockWalletsApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install();
    let reads = 0;
    await page.route(`**/api/wallets/${walletSummary.id}`, async (route) => {
      reads += 1;
      await route.fulfill(
        reads === 1
          ? { status: 429, headers: { 'Retry-After': '30' }, json: {} }
          : { json: walletSummary },
      );
    });
    const text = appDictionary.pageErrors;
    async function expectNoOverflow() {
      const bounds = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(bounds.content).toBeLessThanOrEqual(bounds.viewport);
    }

    // Act
    await page.goto(`/wallets/${walletSummary.id}`);

    // Assert
    await expect(page.getByRole('heading', { name: text.rateLimitedTitle })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: appDictionary.navigation.main }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: text.retry })).toBeDisabled();
    await expectNoOverflow();
    expect(reads).toBe(1);

    // Act
    await page.clock.runFor(30_000);
    await page.getByRole('button', { name: text.retry, exact: true }).click();

    // Assert
    await expect(
      page.getByRole('heading', { name: walletSummary.name, exact: true }),
    ).toBeVisible();
    expect(reads).toBe(2);
    expect(wallets.deleteRequests).toEqual([]);
    expect(wallets.createdWallets).toEqual([]);

    // Act
    await page.goto('/wallets/8b4f1d30-0c6e-4a33-a2a4-9a65c1bbd561/buy');

    // Assert
    await expect(
      page.getByRole('heading', { name: walletDictionary.detail.unavailable, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: appDictionary.navigation.main }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: text.retry, exact: true })).toHaveCount(0);
    await expectNoOverflow();
    await page.screenshot({ path: test.info().outputPath('unavailable-page.png'), fullPage: true });
    await page.getByRole('link', { name: text.back, exact: true }).click();
    await expect(page).toHaveURL(/\/wallets$/u);
    await expect(
      page.getByRole('heading', { name: walletDictionary.page.title, level: 1 }),
    ).toBeVisible();
  });
}
