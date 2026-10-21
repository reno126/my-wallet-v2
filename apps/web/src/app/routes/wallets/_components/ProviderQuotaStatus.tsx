import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

import { useProviderQuota } from '../_hooks/useProviderQuota';
import { pricingDictionary as text, quotaRemaining } from '../pricingDictionary';

export function ProviderQuotaStatus() {
  const { data, refresh, state } = useProviderQuota();
  const quota = data?.ok ? data.value : undefined;
  return (
    <aside aria-label={text.quota.title} className="mb-6 min-w-0">
      <Alert role="note">
        <AlertTitle>{text.quota.title}</AlertTitle>
        <AlertDescription className="flex min-w-0 flex-col gap-2">
          {quota ? (
            <>
              <span>{quotaRemaining(quota.remaining, quota.limit)}</span>
              {!quota.configured ? (
                <span>{text.quota.disabled}</span>
              ) : quota.exhausted ? (
                <span>{text.exhausted}</span>
              ) : quota.remaining <= Math.ceil(quota.limit / 10) ? (
                <span>{text.quota.warning}</span>
              ) : null}
              <Collapsible className="flex min-w-0 flex-col gap-2">
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="self-start">
                    {text.quota.details}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="flex min-w-0 flex-col gap-2">
                  <div>
                    {text.quota.resets}:{' '}
                    <time dateTime={quota.resetsAt}>
                      {new Date(quota.resetsAt).toLocaleString(undefined, {
                        timeZone: quota.timeZone,
                      })}
                    </time>{' '}
                    · {quota.timeZone}
                  </div>
                  <p>{text.quota.tracked}</p>
                </CollapsibleContent>
              </Collapsible>
            </>
          ) : data ? (
            <p>{text.quota.unavailable}</p>
          ) : (
            <div role="status" aria-label={text.quota.loading}>
              <span className="sr-only">{text.quota.loading}</span>
              <Skeleton aria-hidden="true" className="h-5 w-60 max-w-full" />
            </div>
          )}
          {data && !data.ok ? (
            <Button
              variant="outline"
              className="self-start"
              disabled={state !== 'idle'}
              aria-busy={state !== 'idle'}
              onClick={() => void refresh()}
            >
              {state !== 'idle' ? (
                <Spinner aria-hidden="true" role={undefined} data-icon="inline-start" />
              ) : null}
              {text.retry}
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    </aside>
  );
}
