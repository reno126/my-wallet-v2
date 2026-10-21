import type { HoldingValuation, WalletValuation } from '@/lib/api/marketData';
import { formatPercentage, formatUsd } from '@/lib/formatFinancial';

import { pricingDictionary as text } from '../pricingDictionary';
import { LedgerMetric } from './LedgerMetric';
import { PriceFreshness } from './PriceFreshness';
import { ProfitLoss } from './ProfitLoss';

interface ValuationMetricsProps {
  valuation: HoldingValuation | WalletValuation;
}

export function ValuationMetrics({ valuation }: ValuationMetricsProps) {
  const retrievedAt =
    'price' in valuation ? valuation.price?.retrievedAt : valuation.latestPriceUpdateAt;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PriceFreshness freshness={valuation.freshness} />
      <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <LedgerMetric label={text.currentValue}>
          {valuation.currentValue === null ? text.noPrice : formatUsd(valuation.currentValue)}
        </LedgerMetric>
        <LedgerMetric label={text.unrealized}>
          {valuation.unrealizedProfitLoss === null ? (
            text.noPrice
          ) : (
            <ProfitLoss value={valuation.unrealizedProfitLoss} />
          )}
        </LedgerMetric>
        <LedgerMetric label={text.unrealizedPercentage}>
          {valuation.unrealizedProfitLossPercentage === null
            ? text.noPrice
            : formatPercentage(valuation.unrealizedProfitLossPercentage)}
        </LedgerMetric>
        {'allocationPercentage' in valuation ? (
          <LedgerMetric label={text.allocation}>
            {valuation.allocationPercentage === null
              ? text.noPrice
              : formatPercentage(valuation.allocationPercentage)}
          </LedgerMetric>
        ) : null}
        {'price' in valuation ? (
          <>
            <LedgerMetric label={text.unitPrice}>
              {valuation.price === null ? text.noPrice : formatUsd(valuation.price.unitPrice, 4)}
            </LedgerMetric>
            <LedgerMetric label={text.marketDate}>
              {valuation.price === null ? (
                text.noPrice
              ) : (
                <time dateTime={valuation.price.marketDate}>{valuation.price.marketDate}</time>
              )}
            </LedgerMetric>
          </>
        ) : null}
        <LedgerMetric label={text.updatedAt}>
          {retrievedAt ? (
            <time dateTime={retrievedAt}>{new Date(retrievedAt).toLocaleString()}</time>
          ) : (
            text.noPrice
          )}
        </LedgerMetric>
      </dl>
    </div>
  );
}
