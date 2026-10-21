import { describe, expect, it } from 'vitest';

import type { WalletRefreshStatus } from '@/lib/api/marketData';
import { priceValuation, providerQuota, refreshStatus } from '@/test/market-data-api';

import { pricePollingDecision, pricePollLimit } from './pricePolling';

const pending: WalletRefreshStatus = {
  ...refreshStatus(),
  hasPendingWork: true,
  holdings: refreshStatus().holdings.map((holding) => ({ ...holding, status: 'pending' })),
};
const running: WalletRefreshStatus = {
  ...pending,
  holdings: pending.holdings.map((holding) => ({ ...holding, status: 'running' })),
};
const exhausted = { ...providerQuota, exhausted: true, remaining: 0, used: providerQuota.limit };

function decide(overrides: Partial<Parameters<typeof pricePollingDecision>[0]> = {}) {
  return pricePollingDecision({
    valuation: priceValuation(),
    status: pending,
    quota: providerQuota,
    readFailed: false,
    paused: false,
    polls: 0,
    exhaustedPendingChecked: false,
    ...overrides,
  });
}

describe('when deciding whether to check background prices', () => {
  it('should keep checking pending work while admission is available', () => {
    expect(decide()).toBe('poll');
  });

  it('should keep checking a running lease after its final quota unit was consumed', () => {
    expect(decide({ status: running, quota: exhausted })).toBe('poll');
  });

  it('should confirm exhausted pending work once before stopping', () => {
    expect(decide({ quota: exhausted })).toBe('confirm-exhausted');
    expect(decide({ quota: exhausted, exhaustedPendingChecked: true })).toBe('stop');
  });

  it('should reconcile a stale valuation after status becomes fresh even without quota', () => {
    expect(decide({ status: refreshStatus('fresh'), quota: exhausted })).toBe('poll');
  });

  it('should stop after completion or a terminal failure', () => {
    expect(decide({ valuation: priceValuation('fresh'), status: refreshStatus('fresh') })).toBe(
      'stop',
    );
    expect(
      decide({
        status: {
          ...refreshStatus(),
          holdings: pending.holdings.map((holding) => ({ ...holding, status: 'failed' })),
        },
      }),
    ).toBe('stop');
  });

  it('should stop pending work without provider configuration or a readable budget', () => {
    expect(decide({ status: { ...pending, providerConfigured: false } })).toBe('stop');
    expect(decide({ quota: { ...providerQuota, configured: false } })).toBe('stop');
    expect(decide({ quota: undefined })).toBe('stop');
  });

  it('should still observe an active lease when its budget read fails', () => {
    expect(decide({ status: running, quota: undefined })).toBe('poll');
  });

  it('should stop after a valuation or status failure and while paused', () => {
    expect(decide({ readFailed: true })).toBe('stop');
    expect(decide({ status: undefined })).toBe('stop');
    expect(decide({ valuation: undefined })).toBe('stop');
    expect(decide({ paused: true })).toBe('stop');
  });

  it('should pause unfinished work at the automatic polling limit', () => {
    expect(decide({ polls: pricePollLimit - 1 })).toBe('poll');
    expect(decide({ polls: pricePollLimit })).toBe('pause');
    expect(decide({ status: running, quota: exhausted, polls: pricePollLimit })).toBe('pause');
  });
});
