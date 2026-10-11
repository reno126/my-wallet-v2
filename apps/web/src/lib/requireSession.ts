import { redirect } from 'react-router';
import { z as zod } from 'zod';

import { authClient } from './auth-client';

const sessionLookupSchema = zod.object({
  data: zod
    .object({
      user: zod.object({ id: zod.string().min(1) }).passthrough(),
    })
    .nullable(),
  error: zod.unknown().nullable().optional(),
});

export async function getSession() {
  let sessionResult: ReturnType<typeof sessionLookupSchema.safeParse>;

  try {
    sessionResult = sessionLookupSchema.safeParse(
      await authClient.getSession({ query: { disableCookieCache: true } }),
    );
  } catch {
    // React Router route boundaries handle this safe service failure.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw new Response('The authentication service is unavailable.', { status: 503 });
  }

  if (!sessionResult.success || sessionResult.data.error) {
    // React Router route boundaries handle this safe service failure.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw new Response('The authentication service is unavailable.', { status: 503 });
  }

  return sessionResult.data.data;
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    // Redirect Responses are the standard React Router loader/action control flow.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect('/login');
  }

  return session;
}

export async function requestWithSession<T extends { response: Response }>(
  request: () => Promise<T>,
) {
  await requireSession();

  const result = await request();

  if (result.response.status === 401) {
    // Redirect Responses are the standard React Router loader/action control flow.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect('/login');
  }

  return result;
}

export async function redirectAuthenticatedUser() {
  const session = await getSession();

  if (session) {
    // Redirect Responses are the standard React Router loader control flow.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect('/wallets');
  }

  return null;
}
