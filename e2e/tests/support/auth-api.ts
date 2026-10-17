import type { Page } from '@playwright/test';

export type SignInResponse = 'success' | 'api-rate-limit' | 'better-auth-rate-limit';

interface AuthApiMockOptions {
  signInResponse?: SignInResponse;
  initiallySignedIn?: boolean;
}

interface AuthApiMock {
  expireSession: () => void;
  readonly googleSignInRequests: readonly unknown[];
  readonly unexpectedRequests: readonly string[];
}

const authApiRoute = '**/api/auth/**';
const testUser = {
  id: 'test-user',
  email: 'taylor@example.test',
  name: 'Taylor Investor',
};

export async function mockAuthApi(
  page: Page,
  { signInResponse = 'success', initiallySignedIn = false }: AuthApiMockOptions = {},
): Promise<AuthApiMock> {
  let signedIn = initiallySignedIn;
  const googleSignInRequests: unknown[] = [];
  const unexpectedRequests: string[] = [];

  await page.route(authApiRoute, async (route) => {
    const request = route.request();
    const requestPath = new URL(request.url()).pathname;
    const method = request.method();

    if (method === 'GET' && requestPath.endsWith('/api/auth/get-session')) {
      await route.fulfill({
        json: signedIn
          ? {
              session: { id: 'test-session', userId: testUser.id },
              user: testUser,
            }
          : null,
      });
      return;
    }

    if (method === 'POST' && requestPath.endsWith('/api/auth/sign-up/email')) {
      signedIn = true;
      await route.fulfill({ json: successfulAuthResponse() });
      return;
    }

    if (method === 'POST' && requestPath.endsWith('/api/auth/sign-in/email')) {
      if (signInResponse === 'success') {
        signedIn = true;
        await route.fulfill({ json: successfulAuthResponse() });
        return;
      }

      const isApiLimit = signInResponse === 'api-rate-limit';
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '60', 'X-Retry-After': '60' },
        json: isApiLimit
          ? { error: { code: 'RATE_LIMITED', message: 'Private API limiter detail' } }
          : { message: 'Private Better Auth limiter detail', code: 'TOO_MANY_REQUESTS' },
      });
      return;
    }

    if (method === 'POST' && requestPath.endsWith('/api/auth/sign-in/social')) {
      googleSignInRequests.push(request.postDataJSON());
      await route.fulfill({
        status: 503,
        json: { message: 'Google provider is not configured in this test.' },
      });
      return;
    }

    if (method === 'POST' && requestPath.endsWith('/api/auth/sign-out')) {
      signedIn = false;
      await route.fulfill({ json: { success: true } });
      return;
    }

    unexpectedRequests.push(`${method} ${requestPath}`);
    await route.fulfill({ status: 404, json: { message: 'Unexpected auth request.' } });
  });

  return {
    expireSession() {
      signedIn = false;
    },
    get googleSignInRequests() {
      return [...googleSignInRequests];
    },
    get unexpectedRequests() {
      return [...unexpectedRequests];
    },
  };
}

function successfulAuthResponse() {
  return {
    token: 'test-session',
    user: testUser,
  };
}
