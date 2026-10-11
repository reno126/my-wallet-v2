import { Outlet } from 'react-router';

import { authClient } from '../../lib/auth-client';

export function RootLayout() {
  const { isPending } = authClient.useSession();

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12 text-slate-950">
      {isPending ? (
        <p aria-live="polite" className="sr-only">
          Checking your session
        </p>
      ) : null}
      <Outlet />
    </main>
  );
}
