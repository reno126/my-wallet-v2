import { expect, test } from '@playwright/test';

import { mockAuthApi } from './support/auth-api';
import { mockWalletsApi } from './support/wallets-api';

test('a signed-in user can create a wallet from the empty state', async ({ page }) => {
  const auth = await mockAuthApi(page, { initiallySignedIn: true });
  const wallets = await mockWalletsApi(page);

  await page.goto('/wallets');
  await expect(page.getByRole('heading', { name: /wallet space is ready/i })).toBeVisible();
  await page.getByRole('button', { name: /new wallet/i }).click();
  await page.getByRole('textbox', { name: /wallet name/i }).fill('Long-term investing');
  await page.getByRole('textbox', { name: /description/i }).fill('Retirement plan');
  await page.getByRole('button', { name: /^create wallet$/i }).click();

  await expect(page.getByRole('heading', { name: 'Long-term investing' })).toBeVisible();
  await expect(page.getByText('Retirement plan')).toBeVisible();
  await expect(page.getByText('USD', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(wallets.createdWallets).toEqual([
    { name: 'Long-term investing', reportingCurrency: 'USD' },
  ]);
  expect(wallets.unexpectedRequests).toEqual([]);
  expect(auth.unexpectedRequests).toEqual([]);
});
