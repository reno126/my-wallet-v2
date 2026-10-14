import { expect, test } from '@playwright/test';

import { mockAuthApi } from './support/auth-api';
import { mockWalletsApi } from './support/wallets-api';

test.describe('authentication journeys', () => {
  test('registration, logout, and login work through the browser', async ({ page }) => {
    const auth = await mockAuthApi(page);
    await mockWalletsApi(page);

    await page.goto('/');
    await page.getByRole('link', { name: /create your account/i }).click();
    await page.getByRole('textbox', { name: /name/i }).fill('Taylor Investor');
    await page.getByRole('textbox', { name: /email/i }).fill('taylor@example.test');
    await page.getByLabel(/password/i).fill('a-strong-password');
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/wallets$/);
    await expect(page.getByRole('heading', { name: 'Wallets', exact: true })).toBeVisible();

    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL('/');
    await page.getByRole('link', { name: /^sign in$/i }).click();
    await page.getByRole('textbox', { name: /email/i }).fill('taylor@example.test');
    await page.getByLabel(/password/i).fill('a-strong-password');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/wallets$/);
    await expect(page.getByRole('heading', { name: 'Wallets', exact: true })).toBeVisible();
    expect(auth.unexpectedRequests).toEqual([]);
  });

  test('Google sign-in reports a safe error when OAuth is unavailable', async ({ page }) => {
    const auth = await mockAuthApi(page);

    await page.goto('/login');
    await page.getByRole('button', { name: /continue with google/i }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/provider is not configured/i);
    expect(auth.googleSignInRequests).toContainEqual({
      provider: 'google',
      callbackURL: '/wallets',
    });
    expect(auth.unexpectedRequests).toEqual([]);
  });

  const rateLimitScenarios = [
    { name: 'the API limiter', response: 'api-rate-limit' },
    { name: 'the Better Auth limiter', response: 'better-auth-rate-limit' },
  ] as const;

  for (const { name, response } of rateLimitScenarios) {
    test(`shows retry guidance for ${name}`, async ({ page }) => {
      const auth = await mockAuthApi(page, { signInResponse: response });

      await page.goto('/login');
      await page.getByRole('textbox', { name: /email/i }).fill('taylor@example.test');
      await page.getByLabel(/password/i).fill('a-strong-password');
      await page.getByRole('button', { name: /^sign in$/i }).click();

      const alert = page.getByRole('alert');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(/wait|try again/i);
      await expect(alert).not.toContainText(/private .* limiter detail/i);
      expect(auth.unexpectedRequests).toEqual([]);
    });
  }
});
