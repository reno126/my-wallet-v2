import { isRouteErrorResponse, useRouteError } from 'react-router';

export function RootErrorBoundary() {
  const routeError = useRouteError();
  const message = isRouteErrorResponse(routeError)
    ? `The request failed with status ${routeError.status}.`
    : 'An unexpected application error occurred.';

  return (
    <section aria-labelledby="error-title" className="space-y-4" role="alert">
      <h1 className="text-2xl font-semibold" id="error-title">
        Something went wrong
      </h1>
      <p className="text-slate-700">{message}</p>
    </section>
  );
}
