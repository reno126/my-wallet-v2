import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Holding } from '@/lib/api/ledger';
import { formatQuantity, formatUsd } from '@/lib/formatFinancial';

import { ledgerDictionary as text } from '../ledgerDictionary';
import { ProfitLoss } from './LedgerSummary';
import { SellDialog } from './SellDialog';

interface HoldingListProps {
  holdings: Holding[];
}

export function HoldingList({ holdings }: HoldingListProps) {
  if (holdings.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="holdings-title" className="flex min-w-0 flex-col gap-4">
      <h2 id="holdings-title" className="text-xl font-semibold">
        {text.holdings}
      </h2>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {holdings.map((holding) => (
          <Card key={holding.symbol}>
            <CardHeader>
              <CardTitle as="h3">{holding.symbol}</CardTitle>
              <CardDescription className="wrap-anywhere">
                {holding.name} · {holding.exchange}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
              {holding.quantity === '0' ? <Badge variant="secondary">{text.closed}</Badge> : null}
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{text.quantity}</dt>
                  <dd title={holding.quantity} className="wrap-anywhere tabular-nums">
                    {formatQuantity(holding.quantity)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{text.cost}</dt>
                  <dd className="wrap-anywhere tabular-nums">
                    {formatUsd(holding.remainingCostBasis)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{text.average}</dt>
                  <dd className="wrap-anywhere tabular-nums">
                    {holding.averageUnitCost === null
                      ? text.noAverage
                      : formatUsd(holding.averageUnitCost, 4)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{text.realized}</dt>
                  <dd className="wrap-anywhere tabular-nums">
                    <ProfitLoss value={holding.realizedProfitLoss} />
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-3">
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
