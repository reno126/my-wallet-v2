import { expect, test } from '@playwright/test';

import { appDictionary } from '../../apps/web/src/app/appDictionary';
import { ledgerDictionary as text } from '../../apps/web/src/app/routes/wallets/ledgerDictionary';
import {
  emptyHistory,
  ledgerHistory,
  ledgerHolding,
  walletHoldings,
} from '../../apps/web/src/test/ledger-api';
import { walletSummary } from '../../apps/web/src/test/wallet-api';
import { mockAuthApi } from './support/auth-api';
import { responsiveViewportWidths } from './support/viewports';

for (const width of responsiveViewportWidths) {
  test(`ledger details, sale validation and delete confirmation fit at ${width}px`, async ({
    page,
  }) => {
    // Arrange
    await page.setViewportSize({ width, height: 900 });
    await mockAuthApi(page, { initiallySignedIn: true });
    let empty = false;
    let closed = false;
    let failReads = false;
    let saleRequests = 0;
    let deleteRequests = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const path = `/wallets/${walletSummary.id}`;
    const holding = { ...ledgerHolding, name: 'LongCompanyNameWithoutSpaces'.repeat(5) };
    await page.route('**/api/wallets/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST') {
        saleRequests += 1;
        await route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'INSUFFICIENT_HOLDING',
              message: 'Conflict',
              requestId: walletSummary.id,
            },
          },
        });
      } else if (request.method() === 'DELETE') {
        deleteRequests += 1;
        await route.fulfill({
          status: 409,
          json: { error: { code: 'CONFLICT', message: 'Conflict', requestId: walletSummary.id } },
        });
      } else if (url.pathname.endsWith('/holdings/AAPL')) {
        await gate;
        await route.fulfill({
          json: closed
            ? { ...holding, quantity: '0', remainingCostBasis: '0', averageUnitCost: null }
            : holding,
        });
      } else if (url.pathname.endsWith('/holdings')) {
        await route.fulfill(
          failReads ? { status: 503, json: {} } : { json: walletHoldings(empty ? [] : [holding]) },
        );
      } else if (url.pathname.endsWith('/transactions')) {
        await route.fulfill({ json: empty ? emptyHistory() : ledgerHistory });
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
    await page.getByRole('link', { name: text.details('AAPL'), exact: true }).click();
    // Assert
    await expect(
      page.getByRole('status').filter({ hasText: appDictionary.navigation.loading }),
    ).toHaveText(appDictionary.navigation.loading);
    await noOverflow();
    // Act
    release();
    await expect(page.getByRole('heading', { name: text.positionSummary })).toBeVisible();
    await noOverflow();
    await page.screenshot({ path: test.info().outputPath('instrument.png'), fullPage: true });
    await page.getByRole('button', { name: text.sell.open('AAPL'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    // Assert
    await expect(dialog).toHaveAccessibleName(text.sell.title);
    const box = await dialog.boundingBox();
    if (width < 640) {
      expect(box).toMatchObject({ x: 0, y: 0, width, height: 900 });
    }
    // Act
    await dialog.getByRole('button', { name: text.sell.submit, exact: true }).click();
    // Assert
    await expect(dialog.getByRole('textbox', { name: text.sell.quantity })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(saleRequests).toBe(0);
    // Act
    await dialog.getByRole('textbox', { name: text.sell.quantity }).fill('0.5');
    await dialog.getByRole('textbox', { name: text.sell.price }).fill('20');
    await dialog.getByRole('button', { name: text.sell.submit, exact: true }).click();
    // Assert
    await expect(dialog.getByRole('alert')).toHaveText(
      new RegExp(text.errors.insufficient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    await expect(dialog.getByRole('textbox', { name: text.sell.quantity })).toHaveValue('0.5');
    expect(saleRequests).toBe(1);
    await noOverflow();
    await page.screenshot({ path: test.info().outputPath('sale-error.png'), fullPage: false });
    // Act
    await page.keyboard.press('Tab');
    // Assert
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    // Act
    await page.keyboard.press('Escape');
    // Assert
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: text.sell.open('AAPL'), exact: true }),
    ).toBeFocused();
    // Act
    await page.getByRole('button', { name: text.delete.open('AAPL', 'SELL'), exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    // Assert
    await expect(confirmation).toHaveAccessibleDescription(text.delete.warning);
    expect(deleteRequests).toBe(0);
    // Act
    await confirmation.getByRole('button', { name: text.delete.submit, exact: true }).click();
    // Assert
    await expect(confirmation.getByRole('alert')).toContainText(text.errors.conflict);
    expect(deleteRequests).toBe(1);
    await noOverflow();
    await page.screenshot({ path: test.info().outputPath('delete-conflict.png'), fullPage: false });
    // Act
    await confirmation.getByRole('button', { name: text.cancel, exact: true }).click();
    closed = true;
    await page.reload();
    // Assert
    await expect(
      page.getByRole('button', { name: text.sell.open('AAPL'), exact: true }),
    ).toBeDisabled();
    await expect(page.getByText(text.noAverage)).toBeVisible();
    // Act
    empty = true;
    await page.goto(path);
    // Assert
    await expect(page.getByText(text.noTrades, { exact: true })).toBeVisible();
    await noOverflow();
    await page.screenshot({ path: test.info().outputPath('empty-wallet.png'), fullPage: true });
    // Act
    failReads = true;
    await page.reload();
    // Assert
    await expect(page.getByRole('alert')).toContainText(text.loadFailed);
    await noOverflow();
    // Act
    failReads = false;
    await page.getByRole('button', { name: appDictionary.pageErrors.retry, exact: true }).click();
    // Assert
    await expect(page.getByText(text.noTrades, { exact: true })).toBeVisible();
  });
}
