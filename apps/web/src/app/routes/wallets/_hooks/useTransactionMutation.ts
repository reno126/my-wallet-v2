import { useMemo } from 'react';
import { useFetcher, useRevalidator } from 'react-router';

import type { transactionAction } from '../transactionAction';

export function useTransactionMutation() {
  const fetcher = useFetcher<typeof transactionAction>();
  const revalidator = useRevalidator();
  const failure = fetcher.data && !fetcher.data.ok ? fetcher.data : undefined;

  return useMemo(
    () => ({
      busy: fetcher.state !== 'idle' || revalidator.state !== 'idle',
      failure,
      unconfirmed: failure?.unconfirmed ?? false,
      succeeded: fetcher.data?.ok === true && fetcher.state === 'idle',
      submit: fetcher.submit,
      reset: fetcher.reset,
    }),
    [fetcher.state, fetcher.data, fetcher.submit, fetcher.reset, revalidator.state, failure],
  );
}
