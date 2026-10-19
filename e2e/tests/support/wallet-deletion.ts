import { expect, type Page } from '@playwright/test';

import { walletDictionary as text } from '../../../apps/web/src/app/routes/wallets/walletDictionary';

export async function createWallet(page: Page, name: string) {
  await page.goto('/wallets/new');
  await page.getByRole('textbox', { name: text.create.name, exact: true }).fill(name);
  await page.getByRole('button', { name: text.create.submit, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

export function walletDeletion(page: Page) {
  const dialog = page.getByRole('alertdialog');
  return {
    dialog,
    input: dialog.getByRole('textbox', { name: text.delete.nameLabel, exact: true }),
    cancel: dialog.getByRole('button', { name: text.delete.cancel, exact: true }),
    submit: dialog.getByRole('button', { name: text.delete.submit, exact: true }),
    async open() {
      await page.getByRole('button', { name: text.delete.open, exact: true }).click();
      await expect(dialog).toHaveAccessibleName(text.delete.firstTitle);
      await expect(dialog).toHaveAccessibleDescription(text.delete.firstWarning);
      await expect(page.getByText(text.create.confirmed, { exact: true })).toHaveCount(0);
    },
    async advance() {
      await dialog.getByRole('button', { name: text.delete.continue, exact: true }).click();
      await expect(dialog).toHaveAccessibleName(text.delete.finalTitle);
      await expect(dialog).toHaveAccessibleDescription(text.delete.finalWarning);
    },
  };
}
