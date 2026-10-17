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
    throw new Response('The authentication service is unavailable.', { status: 503 });
  }

  if (!sessionResult.success || sessionResult.data.error) {
    throw new Response('The authentication service is unavailable.', { status: 503 });
  }

  return sessionResult.data.data;
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    throw redirect('/login');
  }

  return session;
}

export async function redirectAuthenticatedUser() {
  const session = await getSession();

  if (session) {
    throw redirect('/wallets');
  }

  return null;
}
