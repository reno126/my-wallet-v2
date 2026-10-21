import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from 'react-router';

import type { WalletValuation } from '@/lib/api/marketData';

import {
  canRequestPriceRefresh,
  needsPriceRefresh,
  pricePollingDecision,
  pricePollIntervalMs,
  valuationBehindStatus,
} from '../_utils/pricePolling';
import type { priceRefreshAction, pricingLoader } from '../pricingResource';
import { useProviderQuota } from './useProviderQuota';

export function useWalletPricing(walletId: string) {
  const { data, state, load } = useFetcher<typeof pricingLoader>();
  const refresh = useFetcher<typeof priceRefreshAction>();
  const { data: quotaResult, refresh: refreshQuota } = useProviderQuota();
  const { submit, reset } = refresh;
  const [cachedValuation, setCachedValuation] = useState<WalletValuation>();
  const [paused, setPaused] = useState(false);
  const automaticRequestSent = useRef(false);
  const exhaustedPendingChecked = useRef(false);
  const polls = useRef(0);
  const resource = `/wallets/${walletId}/pricing`;
  const currentValuation =
    data?.valuation.ok && data.valuation.value.walletId === walletId
      ? data.valuation.value
      : undefined;
  if (currentValuation && currentValuation !== cachedValuation) {
    setCachedValuation(currentValuation);
  }
  const valuation =
    currentValuation ?? (cachedValuation?.walletId === walletId ? cachedValuation : undefined);
  const status =
    data?.status.ok && data.status.value.walletId === walletId ? data.status.value : undefined;
  const quota = quotaResult?.ok ? quotaResult.value : undefined;
  const canRefresh = canRequestPriceRefresh(status, quota);
  const needsPrice = needsPriceRefresh(valuation);
  const pricesBehindStatus = valuationBehindStatus(valuation, status);
  const valuationFailed = data?.valuation.ok === false;
  const statusFailed = data?.status.ok === false;
  const quotaFailed = quotaResult?.ok === false;
  const readPrices = useCallback(() => {
    void load(resource);
    void refreshQuota();
  }, [load, resource, refreshQuota]);

  useEffect(() => {
    polls.current = 0;
    exhaustedPendingChecked.current = false;
    readPrices();
  }, [readPrices]);

  useEffect(() => {
    if (
      state === 'idle' &&
      needsPrice &&
      !pricesBehindStatus &&
      canRefresh &&
      !automaticRequestSent.current
    ) {
      automaticRequestSent.current = true;
      void submit({}, { method: 'post', action: resource });
    }
  }, [state, needsPrice, pricesBehindStatus, canRefresh, submit, resource, walletId]);

  useEffect(() => {
    if (state !== 'idle' || refresh.state !== 'idle') {
      return;
    }
    const pollDecision = pricePollingDecision({
      valuation,
      status,
      quota,
      readFailed: valuationFailed || statusFailed,
      paused,
      polls: polls.current,
      exhaustedPendingChecked: exhaustedPendingChecked.current,
    });
    if (pollDecision === 'stop') {
      return;
    }
    const timer = globalThis.setTimeout(() => {
      if (pollDecision === 'pause') {
        setPaused(true);
      } else {
        if (pollDecision === 'confirm-exhausted') {
          exhaustedPendingChecked.current = true;
        }
        polls.current += 1;
        readPrices();
      }
    }, pricePollIntervalMs);
    return () => globalThis.clearTimeout(timer);
  }, [
    valuation,
    status,
    quota,
    valuationFailed,
    statusFailed,
    paused,
    refresh.state,
    state,
    readPrices,
  ]);

  const checkAgain = useCallback(() => {
    polls.current = 0;
    exhaustedPendingChecked.current = false;
    setPaused(false);
    reset();
    readPrices();
  }, [readPrices, reset]);

  const requestRefresh = useCallback(() => {
    polls.current = 0;
    exhaustedPendingChecked.current = false;
    setPaused(false);
    automaticRequestSent.current = true;
    void submit({}, { method: 'post', action: resource });
  }, [submit, resource]);

  return useMemo(
    () => ({
      valuation,
      status,
      quota,
      paused,
      canRefresh,
      needsPrice,
      busy: state !== 'idle' || refresh.state !== 'idle',
      requesting: refresh.state === 'submitting',
      valuationFailed,
      statusFailed,
      quotaFailed,
      refreshFailure: refresh.data && !refresh.data.ok ? refresh.data.error : undefined,
      checkAgain,
      requestRefresh,
    }),
    [
      valuation,
      status,
      quota,
      paused,
      canRefresh,
      needsPrice,
      state,
      refresh.state,
      refresh.data,
      valuationFailed,
      statusFailed,
      quotaFailed,
      checkAgain,
      requestRefresh,
    ],
  );
}
