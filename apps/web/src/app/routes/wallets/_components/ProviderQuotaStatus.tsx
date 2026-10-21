import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { useProviderQuota } from '../_hooks/useProviderQuota';
import { pricingDictionary as text, quotaRemaining } from '../pricingDictionary';

export function ProviderQuotaStatus() {
  const { data, load, state } = useProviderQuota();
  const { pathname } = useLocation();
  useEffect(() => {
    void load('/market-data/quota');
  }, [load, pathname]);
  useEffect(() => {
    if (state !== 'idle') {
      return;
    }
    const timer = globalThis.setTimeout(() => {
      void load('/market-data/quota');
    }, 30_000);
    return () => globalThis.clearTimeout(timer);
  }, [data, load, state]);
  const quota = data?.ok ? data.value : undefined;
  return (
    <aside aria-label={text.quota.title} className="mb-6 min-w-0">
      <Alert role="note">
        <AlertTitle>{text.quota.title}</AlertTitle>
        <AlertDescription>
          {quota ? (
            <div className="flex min-w-0 flex-col gap-1">
              <p>{quotaRemaining(quota.remaining, quota.limit)}</p>
              {!quota.configured ? (
                <p>{text.quota.disabled}</p>
              ) : quota.exhausted ? (
                <p>{text.exhausted}</p>
              ) : quota.remaining <= Math.ceil(quota.limit / 10) ? (
                <p>{text.quota.warning}</p>
              ) : null}
              <p>
                {text.quota.resets}:{' '}
                <time dateTime={quota.resetsAt}>
                  {new Date(quota.resetsAt).toLocaleString(undefined, { timeZone: quota.timeZone })}
                </time>{' '}
                · {quota.timeZone}
              </p>
              <p>{text.quota.tracked}</p>
            </div>
          ) : (
            <p>{data ? text.quota.unavailable : text.quota.loading}</p>
          )}
          {data && !data.ok ? (
            <Button
              variant="outline"
              disabled={state !== 'idle'}
              onClick={() => void load('/market-data/quota')}
            >
              {text.retry}
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    </aside>
  );
}
