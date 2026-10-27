import type { ProviderQuota, WalletRefreshStatus, WalletValuation } from '@/lib/api/marketData';

export const pricePollIntervalMs = 3_000;
export const pricePollLimit = 20;

export function shouldReloadValuation(
  previous: WalletRefreshStatus | undefined,
  next: WalletRefreshStatus,
) {
  if (!previous || previous.holdings.length !== next.holdings.length) {
    return true;
  }
  const previousBySymbol = new Map(previous.holdings.map((holding) => [holding.symbol, holding]));
  return next.holdings.some((holding) => {
    const before = previousBySymbol.get(holding.symbol);
    if (!before) {
      return true;
    }
    const freshnessChanged = before.freshness !== holding.freshness;
    const refreshFinished = holding.status === 'succeeded' || holding.status === 'failed';
    const enteredTerminalState = refreshFinished && before.status !== holding.status;
    return freshnessChanged || enteredTerminalState;
  });
}

interface PricePollingInput {
  valuation: WalletValuation | undefined;
  status: WalletRefreshStatus | undefined;
  quota: ProviderQuota | undefined;
  readFailed: boolean;
  paused: boolean;
  polls: number;
  exhaustedPendingChecked: boolean;
}

export function needsPriceRefresh(valuation: WalletValuation | undefined) {
  return valuation?.freshness === 'stale' || valuation?.freshness === 'missing';
}

export function canRequestPriceRefresh(
  status: WalletRefreshStatus | undefined,
  quota: ProviderQuota | undefined,
) {
  return status?.providerConfigured === true && quota?.configured === true && !quota.exhausted;
}

export function valuationBehindStatus(
  valuation: WalletValuation | undefined,
  status: WalletRefreshStatus | undefined,
) {
  return (
    needsPriceRefresh(valuation) &&
    (status?.freshness === 'fresh' || status?.freshness === 'not_required')
  );
}

export function pricePollingDecision(input: PricePollingInput) {
  const { valuation, status, quota, readFailed, paused, polls, exhaustedPendingChecked } = input;
  if (readFailed || paused || !valuation || !status) {
    return 'stop';
  }
  const running = status.holdings.some((holding) => holding.status === 'running');
  const behindStatus = valuationBehindStatus(valuation, status);
  if (!running && !status.hasPendingWork && !behindStatus) {
    return 'stop';
  }
  const confirmExhausted =
    !running && !behindStatus && quota?.configured && quota.exhausted && !exhaustedPendingChecked;
  if (!running && !behindStatus && !canRequestPriceRefresh(status, quota) && !confirmExhausted) {
    return 'stop';
  }
  if (polls >= pricePollLimit) {
    return 'pause';
  }
  return confirmExhausted ? 'confirm-exhausted' : 'poll';
}
