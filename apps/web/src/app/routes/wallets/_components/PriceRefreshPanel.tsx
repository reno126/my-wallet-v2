import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
  return (
    <Card role="region" aria-label={text.title}>
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {valuation ? (
          <ValuationMetrics valuation={valuation} />
        ) : !pricing.loadFailed ? (
          <p>{text.loading}</p>
        ) : null}
        {notice ? (
          <Alert role="status">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {pricing.canRefresh && pricing.needsPrice ? (
            <Button disabled={pricing.busy} onClick={pricing.requestRefresh}>
              {text.refresh}
            </Button>
          ) : null}
          <Button variant="outline" disabled={pricing.busy} onClick={pricing.checkAgain}>
            {text.retry}
          </Button>
        </div>
      </CardContent>
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
