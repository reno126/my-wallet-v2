import { isRouteErrorResponse, useRouteError } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function RootErrorBoundary() {
  const routeError = useRouteError();
  const message = isRouteErrorResponse(routeError)
    ? `The request failed with status ${routeError.status}.`
    : 'An unexpected application error occurred.';

  return (
    <section aria-labelledby="error-title" className="mx-auto w-full max-w-2xl">
      <Alert variant="destructive">
        <AlertTitle as="h1" className="text-lg" id="error-title">
          Something went wrong
        </AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </section>
  );
}
