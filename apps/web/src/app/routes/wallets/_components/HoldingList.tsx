import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { Holding } from '@/lib/api/ledger';
import type { HoldingValuation } from '@/lib/api/marketData';
import { formatQuantity, formatUsd } from '@/lib/formatFinancial';

import { ledgerDictionary as text } from '../ledgerDictionary';
import { LedgerMetric } from './LedgerMetric';
import { ProfitLoss } from './ProfitLoss';
import { SellDialog } from './SellDialog';
import { SellDialogProvider } from './SellDialogProvider';
import { ValuationMetrics } from './ValuationMetrics';

interface HoldingListProps {
  holdings: Holding[];
  valuations?: HoldingValuation[] | undefined;
}

export function HoldingList({ holdings, valuations }: HoldingListProps) {
  const pricesBySymbol = new Map(valuations?.map((holding) => [holding.symbol, holding]));
  if (holdings.length === 0) {
    return null;
  }
  return (
    <SellDialogProvider>
      <section aria-labelledby="holdings-title" className="flex min-w-0 flex-col gap-4">
        <h2 id="holdings-title" className="text-xl font-semibold">
          {text.holdings}
        </h2>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {holdings.map((holding) => {
            const valuation = pricesBySymbol.get(holding.symbol);
            return (
              <Card key={`${holding.walletId}:${holding.symbol}`}>
                <CardHeader>
                  <CardTitle as="h3">{holding.symbol}</CardTitle>
                  <CardDescription className="wrap-anywhere">
                    {holding.name} · {holding.exchange}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex min-w-0 flex-col gap-4">
                  {holding.quantity === '0' ? (
                    <Badge variant="secondary">{text.closed}</Badge>
                  ) : null}
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <LedgerMetric label={text.quantity} exactValue={holding.quantity}>
                      {formatQuantity(holding.quantity)}
                    </LedgerMetric>
                    <LedgerMetric label={text.cost}>
                      {formatUsd(holding.remainingCostBasis)}
                    </LedgerMetric>
                    <LedgerMetric label={text.average}>
                      {holding.averageUnitCost === null
                        ? text.noAverage
                        : formatUsd(holding.averageUnitCost, 4)}
                    </LedgerMetric>
                    <LedgerMetric label={text.realized}>
                      <ProfitLoss value={holding.realizedProfitLoss} />
                    </LedgerMetric>
                  </dl>
                  {valuation ? (
                    <>
                      <Separator />
                      <ValuationMetrics valuation={valuation} />
                    </>
                  ) : null}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-3">
                  <Button
                    asChild
                    variant="outline"
                    className="h-auto min-h-12 max-w-full py-2 whitespace-normal wrap-anywhere"
                  >
                    <Link
                      to={`/wallets/${holding.walletId}/instruments/${encodeURIComponent(holding.symbol)}`}
                    >
                      {text.details(holding.symbol)}
                    </Link>
                  </Button>
                  <SellDialog holding={holding} />
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </section>
    </SellDialogProvider>
  );
}
