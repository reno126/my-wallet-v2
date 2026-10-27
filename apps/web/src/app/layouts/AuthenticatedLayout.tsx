import { useTransition } from 'react';
import { Link, NavLink, Outlet, useNavigate, useNavigation } from 'react-router';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

import { appDictionary } from '../appDictionary';
import { ProviderQuotaProvider } from '../routes/wallets/_components/ProviderQuotaProvider';
import { ProviderQuotaStatus } from '../routes/wallets/_components/ProviderQuotaStatus';

export function AuthenticatedLayout() {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [isSigningOut, startSignOutTransition] = useTransition();

  function signOut() {
    startSignOutTransition(async () => {
      try {
        const result = await authClient.signOut();

        if (result.error) {
          toast.error(appDictionary.navigation.signOutFailed);
          return;
        }

        await navigate('/', { replace: true });
      } catch {
        toast.error(appDictionary.navigation.signOutFailed);
      }
    });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/80 bg-background/90 backdrop-blur">
        <div className="mx-auto flex min-h-18 w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6 sm:gap-10">
            <Link
              className="flex min-h-12 items-center gap-3 font-semibold tracking-tight"
              to="/wallets"
            >
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"
              >
                MW
              </span>
              <span>{appDictionary.brand}</span>
            </Link>
            <nav aria-label={appDictionary.navigation.main} className="flex items-center">
              <NavLink
                className="inline-flex min-h-12 items-center rounded-lg px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                to="/wallets"
              >
                {appDictionary.navigation.wallets}
              </NavLink>
            </nav>
          </div>
          <Button disabled={isSigningOut} onClick={signOut} variant="outline">
            {isSigningOut ? appDictionary.navigation.signingOut : appDictionary.navigation.signOut}
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 md:py-10 lg:px-8">
        {/* ToDo: replace by nav indicator */}
        {navigation.state === 'loading' ? (
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            {appDictionary.navigation.loading}
          </p>
        ) : null}
        <ProviderQuotaProvider>
          <ProviderQuotaStatus />
          <Outlet />
        </ProviderQuotaProvider>
      </main>
    </div>
  );
}
