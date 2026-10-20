import type { RefreshFailure } from './current-price-provider.ts';

export const refreshLeaseMs = 180_000;
const failureCooldownMs = 300_000;
const retryDelaysMs = [1_000, 2_000];

export function refreshRetryDecision(
  failure: RefreshFailure,
  attempt: number,
  now: Date,
  resetsAt: Date,
) {
  const delay = failure.retryable ? retryDelaysMs[attempt - 1] : undefined;
  return {
    retry: delay !== undefined,
    nextAttemptAt:
      failure.code === 'PROVIDER_QUOTA_EXHAUSTED'
        ? resetsAt
        : new Date(now.getTime() + (delay ?? failureCooldownMs)),
  };
}
