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
    await expectInputContrast(page);

    await page.goto('/login');
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectInputContrast(page);

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

async function expectInputContrast(page: Page) {
  const contrast = await page.getByRole('textbox', { name: /email/i }).evaluate((input) => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) {
      throw new Error('Expected a canvas context for rendered color measurement.');
    }
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
      const linear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return linear(red) * 0.2126 + linear(green) * 0.7152 + linear(blue) * 0.0722;
    };
    let surface: Element | null = input;
    while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') {
      surface = surface.parentElement;
    }
    const background = luminance(getComputedStyle(surface ?? document.body).backgroundColor);
    const border = luminance(getComputedStyle(input).borderTopColor);
    return (Math.max(background, border) + 0.05) / (Math.min(background, border) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(3);
}
