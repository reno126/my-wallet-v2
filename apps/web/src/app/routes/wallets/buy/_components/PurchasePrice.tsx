import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { HistoricalPrice, Instrument } from '@/lib/api/purchases';

import { formatUnitPrice } from '../_utils/purchaseForm';
import { purchaseDictionary as text } from '../purchaseDictionary';

interface PurchasePriceProps {
  instrument: Instrument | null;
  price: HistoricalPrice | undefined;
  loading: boolean;
  error: string | undefined;
  disabled: boolean;
  onRetry: () => void;
}

export function PurchasePrice({
  instrument,
  price,
  loading,
  error,
  disabled,
  onRetry,
}: PurchasePriceProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3" aria-live="polite" aria-busy={loading}>
      {instrument ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-muted-foreground">{text.selected}</p>
          <p className="font-semibold wrap-anywhere">
            {instrument.symbol} · {instrument.name}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{text.needSelection}</p>
      )}
      {loading ? (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{text.loadingPrice}</p>
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3">
            <p>{error}</p>
            <Button type="button" variant="outline" disabled={disabled} onClick={onRetry}>
              {text.retryPrice}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {price ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/50 p-4">
          <dl className="flex flex-col gap-3">
            <div>
              <dt className="text-sm text-muted-foreground">{text.price}</dt>
              <dd className="text-xl font-semibold wrap-anywhere tabular-nums">
                {formatUnitPrice(price.unitPrice)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{text.effectiveDate}</dt>
              <dd>
                <time dateTime={price.effectiveDate}>{price.effectiveDate}</time>
              </dd>
            </div>
          </dl>
          <p className="text-sm wrap-anywhere text-muted-foreground">
            {text.exactPrice(price.unitPrice)}
          </p>
          <p className="text-xs text-muted-foreground">{text.source}</p>
          {price.usedPreviousTradingDay ? (
            <Alert role="status">
              <AlertDescription>{text.fallback}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
