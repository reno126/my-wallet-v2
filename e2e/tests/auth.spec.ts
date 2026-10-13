import { expect, type Page, test } from '@playwright/test';

type SignInResponse = 'success' | 'api-rate-limit' | 'better-auth-rate-limit';

test('registration, logout, and login work through the browser', async ({ page }) => {
  const auth = await mockAuthRequests(page);

  await page.goto('/');
  await page.getByRole('link', { name: /create your account/i }).click();
  await page.getByRole('textbox', { name: /name/i }).fill('Taylor Investor');
  await page.getByRole('textbox', { name: /email/i }).fill('taylor@example.test');
  await page.getByLabel(/password/i).fill('a-strong-password');
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/wallets$/);
  await expect(page.getByRole('heading', { name: /wallets/i })).toBeVisible();

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL('/');
  await page.getByRole('link', { name: /^sign in$/i }).click();
  await page.getByRole('textbox', { name: /email/i }).fill('taylor@example.test');
  await page.getByLabel(/password/i).fill('a-strong-password');
  await page.getByRole('button', { name: /^sign in$/i }).click();

  await expect(page).toHaveURL(/\/wallets$/);
  await expect(page.getByRole('heading', { name: /wallets/i })).toBeVisible();
  expect(auth.registered).toBe(true);
  expect(auth.signedIn).toBe(true);
});

test('Google sign-in stays on the mocked provider path when OAuth is unavailable', async ({
  page,
}) => {
  const auth = await mockAuthRequests(page);

  await page.goto('/login');
  await page.getByRole('button', { name: /continue with google/i }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  expect(auth.googleRequested()).toBe(true);
});

for (const responseKind of ['api-rate-limit', 'better-auth-rate-limit'] as const) {
  test(`shows retry guidance for the ${responseKind} response in a real browser`, async ({
    page,
  }) => {
    await mockAuthRequests(page, responseKind);
    await page.goto('/login');
    await page.getByRole('textbox', { name: /email/i }).fill('taylor@example.test');
    await page.getByLabel(/password/i).fill('a-strong-password');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByRole('alert')).toContainText(/too many attempts/i);
  });
}

test('public and auth pages fit phone, tablet, and desktop widths without page overflow', async ({
  page,
}) => {
  await mockAuthRequests(page);

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/register');

    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();

    await expectNoPageOverflow(page);

    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /a clearer view of your investments/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /create your account/i })).toBeVisible();

    await expectNoPageOverflow(page);
  }
});

async function expectNoPageOverflow(page: Page) {
  const pageWidths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));

  expect(pageWidths.content).toBeLessThanOrEqual(pageWidths.viewport);
}

async function mockAuthRequests(page: Page, signInResponse: SignInResponse = 'success') {
  let signedIn = false;
  let registered = false;
  let googleRequested = false;

  await page.route('**/api/auth/**', async (route) => {
    const request = route.request();
    const requestURL = new URL(request.url());
    const requestPath = requestURL.pathname;

    if (request.method() === 'GET' && requestPath.endsWith('/get-session')) {
      await route.fulfill({
        json: signedIn
          ? {
              session: { id: 'test-session', userId: 'test-user' },
              user: { id: 'test-user', email: 'taylor@example.test', name: 'Taylor Investor' },
            }
          : null,
      });
      return;
    }

    if (requestPath.endsWith('/sign-up/email')) {
      registered = true;
      signedIn = true;
      await route.fulfill({
        json: {
          token: 'test-session',
          user: { id: 'test-user', email: 'taylor@example.test', name: 'Taylor Investor' },
        },
      });
      return;
    }

    if (requestPath.endsWith('/sign-in/email')) {
      if (signInResponse === 'success') {
        signedIn = true;
        await route.fulfill({
          json: {
            token: 'test-session',
            user: { id: 'test-user', email: 'taylor@example.test', name: 'Taylor Investor' },
          },
        });
        return;
      }

      const apiError = signInResponse === 'api-rate-limit';
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '60', 'X-Retry-After': '60' },
        json: apiError
          ? { error: { code: 'RATE_LIMITED', message: 'Private API limiter detail' } }
          : { message: 'Private Better Auth limiter detail', code: 'TOO_MANY_REQUESTS' },
      });
      return;
    }

    if (requestPath.endsWith('/sign-in/social')) {
      const requestPayload: unknown = request.postDataJSON();
      googleRequested =
        typeof requestPayload === 'object' &&
        requestPayload !== null &&
        'provider' in requestPayload &&
        requestPayload.provider === 'google';
      await route.fulfill({
        status: 503,
        json: { message: 'Google provider is not configured in this test.' },
      });
      return;
    }

    if (requestPath.endsWith('/sign-out')) {
      signedIn = false;
      await route.fulfill({ json: { success: true } });
      return;
    }

    await route.fulfill({ status: 404, json: { message: 'Unexpected auth request.' } });
  });

  return {
    get registered() {
      return registered;
    },
    get signedIn() {
      return signedIn;
    },
    googleRequested: () => googleRequested,
  };
}
