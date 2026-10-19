import { expect, type Locator, test } from '@playwright/test';

import { mockAuthApi } from './support/auth-api';
import { responsiveViewportWidths } from './support/viewports';
import { createWallet, walletDeletion } from './support/wallet-deletion';
import { mockWalletsApi } from './support/wallets-api';

for (const width of responsiveViewportWidths) {
  test(`both delete warnings and confirmation fit at ${width}px`, async ({ page }) => {
    await mockAuthApi(page, { initiallySignedIn: true });
    const wallets = await mockWalletsApi(page);
    await page.setViewportSize({ width, height: width < 640 ? 568 : 900 });
    const name = 'W'.repeat(100);
    await createWallet(page, name);
    const deletion = walletDeletion(page);
    await deletion.open();
    await expectDialogToFit(deletion.dialog, width);
    await expect(deletion.cancel).toBeVisible();
    if (width === 375 || width === 1440) {
      await page.screenshot({
        path: test.info().outputPath('delete-first-warning.png'),
        fullPage: true,
      });
    }
    await deletion.advance();
    await expectDialogToFit(deletion.dialog, width);
    await deletion.input.fill('Mismatch');
    await expect(deletion.input).toHaveAttribute('aria-invalid', 'true');
    await expect(deletion.submit).toBeDisabled();
    await expectDialogToFit(deletion.dialog, width);
    await deletion.input.fill(name);
    await expect(deletion.submit).toBeEnabled();
    await deletion.submit.click({ trial: true });
    if (width === 375 || width === 1440) {
      await page.screenshot({
        path: test.info().outputPath('delete-final-warning.png'),
        fullPage: true,
      });
    }
    await deletion.cancel.click();
    await expect(deletion.dialog).toHaveCount(0);
    expect(wallets.deleteRequests).toEqual([]);
  });
}

async function expectDialogToFit(dialog: Locator, width: number) {
  const bounds = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      content: element.scrollWidth,
      width: element.clientWidth,
      height: box.height,
      viewportHeight: window.innerHeight,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  expect(bounds.content).toBeLessThanOrEqual(bounds.width + 1);
  if (width < 640) expect(bounds.height).toBe(bounds.viewportHeight);
}
