import { expect, test } from '@playwright/test';

import { walletDictionary as text } from '../../apps/web/src/app/routes/wallets/walletDictionary';
import { mockAuthApi } from './support/auth-api';
import { createWallet, walletDeletion } from './support/wallet-deletion';
import { mockWalletsApi } from './support/wallets-api';

test('deletes a created wallet only after both warnings and exact-name submission, preserving another wallet', async ({
  page,
}) => {
  const auth = await mockAuthApi(page, { initiallySignedIn: true });
  const wallets = await mockWalletsApi(page);
  const siblingPath = await createWallet(page, 'Keep this wallet');
  const name = 'Long-term investing';
  const selectedPath = await createWallet(page, name);
  const deletion = walletDeletion(page);
  await deletion.open();
  await expect(deletion.input).toHaveCount(0);
  await expect(deletion.submit).toHaveCount(0);
  expect(wallets.deleteRequests).toEqual([]);
  await deletion.advance();
  await expect(deletion.submit).toBeDisabled();
  for (const mismatch of [name.toLowerCase(), `${name} `]) {
    await deletion.input.fill(mismatch);
    await expect(deletion.input).toHaveAttribute('aria-invalid', 'true');
    await expect(deletion.submit).toBeDisabled();
  }
  await deletion.input.fill(name);
  await expect(deletion.submit).toBeEnabled();
  await deletion.input.press('Enter');
  expect(wallets.deleteRequests).toEqual([]);
  await deletion.submit.focus();
  await deletion.submit.press('Enter');
  await expect(page).toHaveURL(/\/wallets$/u);
  await expect(page.getByText(text.delete.confirmed, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Keep this wallet', exact: true })).toBeVisible();
  expect(wallets.deleteRequests).toEqual([`/api${selectedPath}`]);
  await page.goto(selectedPath);
  await expect(page.getByRole('heading', { name: text.detail.unavailable })).toBeVisible();
  await page.goto(siblingPath);
  await expect(page.getByRole('heading', { name: 'Keep this wallet', exact: true })).toBeVisible();
  expect(wallets.unexpectedRequests).toEqual([]);
  expect(auth.unexpectedRequests).toEqual([]);
});

test('cancellation and Escape preserve the wallet and reset confirmation, with keyboard focus contained', async ({
  page,
}) => {
  await mockAuthApi(page, { initiallySignedIn: true });
  const wallets = await mockWalletsApi(page);
  const name = 'Keep my wallet';
  await createWallet(page, name);
  const deletion = walletDeletion(page);
  await deletion.open();
  await expect(deletion.cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(deletion.dialog.getByRole('button', { name: text.delete.continue })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(deletion.cancel).toBeFocused();
  await deletion.cancel.click();
  await expect(deletion.dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: text.delete.open, exact: true })).toBeFocused();
  await deletion.open();
  await deletion.advance();
  await deletion.input.fill(name);
  await deletion.cancel.click();
  await expect(deletion.dialog).toHaveCount(0);
  await deletion.open();
  await deletion.advance();
  await expect(deletion.input).toHaveValue('');
  await expect(deletion.submit).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(deletion.dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(wallets.deleteRequests).toEqual([]);
});

test('an expired session during deletion redirects to login without a success notice', async ({
  page,
}) => {
  const auth = await mockAuthApi(page, { initiallySignedIn: true });
  await mockWalletsApi(page);
  const path = await createWallet(page, 'Private wallet');
  const deletion = walletDeletion(page);
  await deletion.open();
  await deletion.advance();
  await deletion.input.fill('Private wallet');
  let deletes = 0;
  await page.route(`**/api${path}`, async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.fallback();
      return;
    }
    deletes += 1;
    auth.expireSession();
    await route.fulfill({ status: 401, json: {} });
  });
  await deletion.submit.click();
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  await expect(page.getByText(text.delete.confirmed, { exact: true })).toHaveCount(0);
  expect(deletes).toBe(1);
});
