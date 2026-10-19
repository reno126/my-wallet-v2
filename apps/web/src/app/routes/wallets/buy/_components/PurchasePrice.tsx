import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Instrument } from '@/lib/api/purchases';

import type { PurchaseQuoteState } from '../_hooks/usePurchaseQuote';
import { formatUnitPrice } from '../_utils/purchaseForm';
import { purchaseDictionary as text } from '../purchaseDictionary';

interface PurchasePriceProps {
  instrument: Instrument | null;
  state: PurchaseQuoteState;
  disabled: boolean;
  onRetry: () => void;
}

export function PurchasePrice({ instrument, state, disabled, onRetry }: PurchasePriceProps) {
  const price = state.status === 'ready' ? state.price : undefined;
  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      aria-live="polite"
      aria-busy={state.status === 'loading'}
    >
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
      {state.status === 'loading' ? (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{text.loadingPrice}</p>
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3">
            <p>{state.message}</p>
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
