import { useState, useTransition } from 'react';
import { useNavigate } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient } from '@/lib/auth-client';

export function WalletsRoute() {
  const navigate = useNavigate();
  const [isSigningOut, startSignOutTransition] = useTransition();
  const [signOutFailed, setSignOutFailed] = useState(false);

  function signOut() {
    startSignOutTransition(async () => {
      try {
        const result = await authClient.signOut();

        if (result.error) {
          setSignOutFailed(true);
          return;
        }

        await navigate('/', { replace: true });
      } catch {
        setSignOutFailed(true);
      }
    });
  }

  return (
    <section aria-labelledby="wallets-title" className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-3xl font-semibold tracking-tight" id="wallets-title">
            Wallets
          </CardTitle>
          <CardDescription>Your authenticated wallet area is ready.</CardDescription>
          {signOutFailed ? (
            <Alert variant="destructive">
              <AlertDescription>We could not sign you out. Please try again.</AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="mt-4 w-fit"
            disabled={isSigningOut}
            onClick={signOut}
            variant="outline"
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </CardHeader>
      </Card>
    </section>
  );
}
