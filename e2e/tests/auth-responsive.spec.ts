import { expect, type Page, test } from '@playwright/test';

import { mockAuthApi } from './support/auth-api';
import { responsiveViewportWidths } from './support/viewports';

for (const width of responsiveViewportWidths) {
  test(`landing, login, and registration pages fit at ${width}px`, async ({ page }) => {
    const auth = await mockAuthApi(page);
    await page.setViewportSize({ width, height: 900 });

    await page.goto('/register');
    await expect(page.getByRole('textbox', { name: /name/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto('/login');
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /a clearer view of your investments/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /create your account/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(auth.unexpectedRequests).toEqual([]);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const pageWidths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));

  expect(pageWidths.content).toBeLessThanOrEqual(pageWidths.viewport);
}
