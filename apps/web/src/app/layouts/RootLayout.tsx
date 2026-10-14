import { Outlet } from 'react-router';

import { Toaster } from '@/components/ui/sonner';

import { authClient } from '../../lib/auth-client';

export function RootLayout() {
  const { isPending } = authClient.useSession();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {isPending ? (
        <p aria-live="polite" className="sr-only">
          Checking your session
        </p>
      ) : null}
      <Outlet />
      <Toaster position="top-right" />
    </div>
  );
}
