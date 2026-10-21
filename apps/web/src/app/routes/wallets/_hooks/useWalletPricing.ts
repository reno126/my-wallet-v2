import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from 'react-router';

import type { WalletValuation } from '@/lib/api/marketData';

import type { priceRefreshAction, pricingLoader } from '../pricingResource';
import { useProviderQuota } from './useProviderQuota';

export const pricePollIntervalMs = 3_000;
export const pricePollLimit = 20;

export function useWalletPricing(walletId: string) {
  const { data, state, load } = useFetcher<typeof pricingLoader>();
  const refresh = useFetcher<typeof priceRefreshAction>();
  const { data: quotaResult, load: loadQuota } = useProviderQuota();
  const { submit, reset } = refresh;
  const [cachedValuation, setCachedValuation] = useState<WalletValuation>();
  const [pausedWallet, setPausedWallet] = useState<string>();
  const paused = pausedWallet === walletId;
  const automaticRequestSent = useRef<string | undefined>(undefined);
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
  const canRefresh =
    status?.providerConfigured === true && quota?.configured === true && !quota.exhausted;
  const needsPrice = valuation?.freshness === 'stale' || valuation?.freshness === 'missing';
  const pricesBehindStatus =
    needsPrice && (status?.freshness === 'fresh' || status?.freshness === 'not_required');
  const running = status?.holdings.some((holding) => holding.status === 'running') ?? false;
  const shouldPoll = running || status?.hasPendingWork === true || pricesBehindStatus;
  const readPrices = useCallback(() => {
    void load(resource);
    void loadQuota('/market-data/quota');
  }, [load, resource, loadQuota]);

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
      automaticRequestSent.current !== walletId
    ) {
      automaticRequestSent.current = walletId;
      void submit({}, { method: 'post', action: resource });
    }
  }, [state, needsPrice, pricesBehindStatus, canRefresh, submit, resource, walletId]);

  useEffect(() => {
    if (
      state !== 'idle' ||
      refresh.state !== 'idle' ||
      !shouldPoll ||
      !data?.valuation.ok ||
      paused
    ) {
      return;
    }
    if (
      !running &&
      !pricesBehindStatus &&
      !canRefresh &&
      (!quota?.configured || !quota.exhausted || exhaustedPendingChecked.current)
    ) {
      return;
    }
    const timer = globalThis.setTimeout(() => {
      if (polls.current >= pricePollLimit) {
        setPausedWallet(walletId);
      } else {
        if (!running && quota?.exhausted) {
          exhaustedPendingChecked.current = true;
        }
        polls.current += 1;
        readPrices();
      }
    }, pricePollIntervalMs);
    return () => globalThis.clearTimeout(timer);
  }, [
    data,
    paused,
    refresh.state,
    shouldPoll,
    state,
    walletId,
    running,
    pricesBehindStatus,
    canRefresh,
    quota,
    readPrices,
  ]);

  const checkAgain = useCallback(() => {
    polls.current = 0;
    exhaustedPendingChecked.current = false;
    setPausedWallet(undefined);
    reset();
    readPrices();
  }, [readPrices, reset]);

  const requestRefresh = useCallback(() => {
    polls.current = 0;
    exhaustedPendingChecked.current = false;
    setPausedWallet(undefined);
    automaticRequestSent.current = walletId;
    void submit({}, { method: 'post', action: resource });
  }, [submit, resource, walletId]);

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
      loadFailed:
        (data !== undefined && (!data.valuation.ok || !data.status.ok)) ||
        quotaResult?.ok === false,
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
      data,
      quotaResult,
      checkAgain,
      requestRefresh,
    ],
  );
}
