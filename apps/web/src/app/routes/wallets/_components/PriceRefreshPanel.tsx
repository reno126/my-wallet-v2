import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

import type { useWalletPricing } from '../_hooks/useWalletPricing';
import { pricingDictionary as text } from '../pricingDictionary';
import { ValuationMetrics } from './ValuationMetrics';

interface PriceRefreshPanelProps {
  pricing: ReturnType<typeof useWalletPricing>;
  symbol?: string;
}

export function PriceRefreshPanel({ pricing, symbol }: PriceRefreshPanelProps) {
  const valuation = symbol
    ? pricing.valuation?.holdings.find((holding) => holding.symbol === symbol)
    : pricing.valuation;
  const notice = priceNotice(pricing);
  const checking = pricing.busy && !pricing.requesting;
  return (
    <Card role="region" aria-label={text.title}>
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {valuation ? (
          <ValuationMetrics valuation={valuation} />
        ) : !pricing.loadFailed ? (
          <div role="status" aria-label={text.loading}>
            <span className="sr-only">{text.loading}</span>
            <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          </div>
        ) : null}
        {notice ? (
          <Alert role="status">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        {pricing.canRefresh && pricing.needsPrice ? (
          <Button
            disabled={pricing.busy}
            aria-busy={pricing.requesting}
            onClick={pricing.requestRefresh}
          >
            {pricing.requesting ? (
              <Spinner aria-hidden="true" role={undefined} data-icon="inline-start" />
            ) : null}
            {text.refresh}
          </Button>
        ) : null}
        <Button
          variant="outline"
          disabled={pricing.busy}
          aria-busy={checking}
          onClick={pricing.checkAgain}
        >
          {checking ? (
            <Spinner aria-hidden="true" role={undefined} data-icon="inline-start" />
          ) : null}
          {text.retry}
        </Button>
      </CardFooter>
    </Card>
  );
}

function priceNotice(pricing: ReturnType<typeof useWalletPricing>) {
  if (pricing.loadFailed) {
    return text.unavailable;
  }
  if (pricing.refreshFailure?.kind === 'http' && pricing.refreshFailure.status === 429) {
    return text.limited;
  }
  if (pricing.refreshFailure && pricing.needsPrice) {
    return text.refreshFailed;
  }
  if (pricing.requesting) {
    return text.requesting;
  }
  if (pricing.paused) {
    return text.paused;
  }
  if (pricing.status?.holdings.some((holding) => holding.status === 'running')) {
    return text.running;
  }
  if (pricing.quota?.exhausted && pricing.needsPrice) {
    return text.exhausted;
  }
  if (pricing.status?.providerConfigured === false) {
    return text.providerUnavailable;
  }
  if (pricing.status?.hasPendingWork) {
    return text.pending;
  }
  if (pricing.status?.holdings.some((holding) => holding.status === 'failed')) {
    return text.failed;
  }
  if (pricing.valuation?.freshness === 'missing') {
    return text.missing;
  }
  if (pricing.valuation?.freshness === 'stale') {
    return text.stale;
  }
  return undefined;
}
