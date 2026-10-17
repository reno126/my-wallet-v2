import { expect, test } from '@playwright/test';

import { walletDictionary } from '../../apps/web/src/app/routes/wallets/walletDictionary';
import { mockAuthApi } from './support/auth-api';
import { mockWalletsApi } from './support/wallets-api';

test('a signed-in user can create a wallet on its page and reload its details', async ({
  page,
}) => {
  const auth = await mockAuthApi(page, { initiallySignedIn: true });
  const wallets = await mockWalletsApi(page);

  await page.goto('/wallets');
  await expect(page.getByRole('heading', { name: /wallet space is ready/i })).toBeVisible();
  await page.getByRole('link', { name: /new wallet/i }).click();
  await expect(page).toHaveURL(/\/wallets\/new$/u);
  await page.getByRole('textbox', { name: /wallet name/i }).fill('Long-term investing');
  await page.getByRole('textbox', { name: /description/i }).fill('Retirement plan');
  await page.getByRole('button', { name: /^create wallet$/i }).click();

  await expect(page.getByRole('heading', { name: 'Long-term investing' })).toBeVisible();
  await expect(page.getByText('Retirement plan')).toBeVisible();
  await expect(page.getByText('USD', { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/wallets\/[0-9a-f-]{36}$/u);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Long-term investing' })).toBeVisible();
  await expect(page.getByText(walletDictionary.create.confirmed, { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: /back to wallets/i }).click();
  await expect(page.getByRole('link', { name: 'Long-term investing' })).toBeVisible();
  expect(wallets.createdWallets).toEqual([
    { name: 'Long-term investing', reportingCurrency: 'USD' },
  ]);
  expect(wallets.unexpectedRequests).toEqual([]);
  expect(auth.unexpectedRequests).toEqual([]);
});

test('an unavailable wallet retains its heading hierarchy', async ({ page }) => {
  await mockAuthApi(page, { initiallySignedIn: true });
  await mockWalletsApi(page);
  await page.goto('/wallets/8b4f1d30-0c6e-4a33-a2a4-9a65c1bbd561');

  const heading = page.getByRole('heading', {
    level: 1,
    name: walletDictionary.detail.unavailable,
  });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS('font-size', '30px');
});

test('an expired session redirects a rejected POST to login', async ({ page }) => {
  const auth = await mockAuthApi(page, { initiallySignedIn: true });
  await mockWalletsApi(page);
  let posts = 0;
  await page.route('**/api/wallets', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    posts += 1;
    await route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/wallets/new');
  await page.getByRole('textbox', { name: /wallet name/i }).fill('Core');
  auth.expireSession();
  await page.getByRole('button', { name: /^create wallet$/i }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  expect(posts).toBe(1);
});

test('a rate limited POST keeps entered values available for retry', async ({ page }) => {
  await mockAuthApi(page, { initiallySignedIn: true });
  await mockWalletsApi(page);
  await page.route('**/api/wallets', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, json: {} });
  });
  await page.goto('/wallets/new');
  await page.getByRole('textbox', { name: /wallet name/i }).fill('Core');
  await page.getByRole('textbox', { name: /description/i }).fill('Keep this description');
  await page.getByRole('button', { name: /^create wallet$/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /wallet name/i })).toHaveValue('Core');
  await expect(page.getByRole('textbox', { name: /description/i })).toHaveValue(
    'Keep this description',
  );
  await expect(page.getByRole('button', { name: /^create wallet$/i })).toBeEnabled();
  await expect(page).toHaveURL(/\/wallets\/new$/u);
});
