import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from 'react-router';

import {
  canRequestPriceRefresh,
  needsPriceRefresh,
  pricePollingDecision,
  pricePollIntervalMs,
  shouldReloadValuation,
  valuationBehindStatus,
} from '../_utils/pricePolling';
import type { priceRefreshAction, pricingLoader } from '../pricingResource';
import { usePricingRevalidation } from './usePricingRevalidation';
import { useProviderQuota, useProviderQuotaState } from './useProviderQuota';
import { useWalletValuation } from './useWalletValuation';

export function useWalletPricing(walletId: string) {
  const { data, state, load } = useFetcher<typeof pricingLoader>();
  const {
    data: progressData,
    state: progressState,
    load: loadProgress,
    reset: resetProgress,
  } = useFetcher<typeof pricingLoader>();
  const refresh = useFetcher<typeof priceRefreshAction>();
  const { data: quotaResult, refresh: refreshQuota } = useProviderQuota();
  const quotaState = useProviderQuotaState();
  const { submit, reset } = refresh;
  const lastRefreshResult = useRef(refresh.data);
  const lastProgressRead = useRef(progressData);
  const lastFullRead = useRef(data);
  const fullReadInFlight = useRef(false);
  const valuation = useWalletValuation(walletId, data?.valuation);
  const [paused, setPaused] = useState(false);
  const automaticRequestDay = useRef<string | undefined>(undefined);
  const exhaustedPendingChecked = useRef(false);
  const polls = useRef(0);
  const resource = `/wallets/${walletId}/pricing`;
  const statusResult = progressData?.status ?? data?.status;
  const status =
    statusResult?.ok && statusResult.value.walletId === walletId ? statusResult.value : undefined;
  const quota = quotaResult?.ok ? quotaResult.value : undefined;
  const canRefresh = canRequestPriceRefresh(status, quota);
  const needsPrice = needsPriceRefresh(valuation);
  const pricesBehindStatus = valuationBehindStatus(valuation, status);
  const valuationFailed = data?.valuation?.ok === false;
  const statusFailed = statusResult?.ok === false;
  const quotaFailed = quotaResult?.ok === false;
  const readPrices = useCallback(() => {
    fullReadInFlight.current = true;
    resetProgress();
    void load(resource);
    void refreshQuota();
  }, [load, resource, refreshQuota, resetProgress]);

  useEffect(() => {
    polls.current = 0;
    exhaustedPendingChecked.current = false;
    readPrices();
  }, [readPrices]);

  useEffect(() => {
    if (state !== 'idle' || !data || data === lastFullRead.current) {
      return;
    }
    lastFullRead.current = data;
    lastProgressRead.current = progressData;
    fullReadInFlight.current = false;
    resetProgress();
  }, [data, state, progressData, resetProgress]);

  useEffect(() => {
    if (
      state !== 'idle' ||
      progressState !== 'idle' ||
      !progressData ||
      progressData === lastProgressRead.current ||
      fullReadInFlight.current
    ) {
      return;
    }
    lastProgressRead.current = progressData;
    if (
      progressData.status.ok &&
      (shouldReloadValuation(
        data?.status.ok ? data.status.value : undefined,
        progressData.status.value,
      ) ||
        pricesBehindStatus)
    ) {
      readPrices();
    }
  }, [data, progressData, progressState, state, pricesBehindStatus, readPrices]);

  useEffect(() => {
    if (refresh.state === 'idle' && refresh.data && refresh.data !== lastRefreshResult.current) {
      lastRefreshResult.current = refresh.data;
      readPrices();
    }
  }, [refresh.state, refresh.data, readPrices]);

  const checkAgain = useCallback(() => {
    polls.current = 0;
    exhaustedPendingChecked.current = false;
    setPaused(false);
    reset();
    readPrices();
  }, [readPrices, reset]);

  usePricingRevalidation({
    quotaDate: quota?.quotaDate,
    busy: state !== 'idle' || progressState !== 'idle' || refresh.state !== 'idle',
    revalidate: checkAgain,
  });

  useEffect(() => {
    if (
      state === 'idle' &&
      progressState === 'idle' &&
      refresh.state === 'idle' &&
      quotaState === 'idle' &&
      !fullReadInFlight.current &&
      !valuationFailed &&
      !statusFailed &&
      needsPrice &&
      !pricesBehindStatus &&
      canRefresh &&
      quota &&
      automaticRequestDay.current !== quota.quotaDate
    ) {
      automaticRequestDay.current = quota.quotaDate;
      void submit({}, { method: 'post', action: resource, defaultShouldRevalidate: false });
    }
  }, [
    state,
    progressState,
    refresh.state,
    quotaState,
    valuationFailed,
    statusFailed,
    needsPrice,
    pricesBehindStatus,
    canRefresh,
    quota,
    submit,
    resource,
  ]);

  useEffect(() => {
    if (
      state !== 'idle' ||
      progressState !== 'idle' ||
      refresh.state !== 'idle' ||
      fullReadInFlight.current
    ) {
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
        void loadProgress(`${resource}?statusOnly=true`);
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
    progressState,
    loadProgress,
    resource,
  ]);

  const requestRefresh = useCallback(() => {
    polls.current = 0;
    exhaustedPendingChecked.current = false;
    setPaused(false);
    automaticRequestDay.current = quota?.quotaDate;
    void submit({}, { method: 'post', action: resource, defaultShouldRevalidate: false });
  }, [submit, resource, quota?.quotaDate]);

  return useMemo(
    () => ({
      valuation,
      status,
      quota,
      paused,
      canRefresh,
      needsPrice,
      busy: state !== 'idle' || progressState !== 'idle' || refresh.state !== 'idle',
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
      progressState,
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
