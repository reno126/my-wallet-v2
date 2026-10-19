import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

import { LoadError } from '@/components/shared/LoadError';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';

import { appDictionary } from '../appDictionary';
import { pageFailureSchema } from './_utils/pageFailure';

export function PrivateRouteErrorBoundary() {
  const error = useRouteError();
  const parsed = pageFailureSchema.safeParse(isRouteErrorResponse(error) ? error.data : undefined);
  const failure = parsed.success ? parsed.data : undefined;
  const isRetryable = isRouteErrorResponse(error) && (error.status === 429 || error.status >= 500);
  const text = appDictionary.pageErrors;
  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      aria-labelledby="page-error-title"
    >
      <div>
        <Button asChild variant="outline">
          <Link to="/wallets">{text.back}</Link>
        </Button>
      </div>
      <h1 id="page-error-title" className="text-3xl font-semibold">
        {failure?.title ?? text.unexpectedTitle}
      </h1>
      {failure ? (
        isRetryable ? (
          <LoadError
            key={failure.retryAt}
            message={failure.message}
            retryLabel={text.retry}
            {...(failure.retryAt === undefined ? {} : { retryAt: failure.retryAt })}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{failure.message}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3">
            <p>{text.unexpectedMessage}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              {text.reload}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
