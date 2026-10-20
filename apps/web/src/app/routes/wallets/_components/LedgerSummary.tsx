import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Holding, WalletHoldings } from '@/lib/api/ledger';
import { formatQuantity, formatUsd } from '@/lib/formatFinancial';

import { ledgerDictionary as text } from '../ledgerDictionary';

interface ProfitLossProps {
  value: string;
}

export function ProfitLoss({ value }: ProfitLossProps) {
  const negative = value.startsWith('-');
  const zero = /^-?0(?:\.0+)?$/u.test(value);
  return (
    <span className={zero ? '' : negative ? 'text-destructive' : 'text-primary'}>
      {zero ? text.unchanged : negative ? text.loss : text.gain}: {formatUsd(value)}
    </span>
  );
}

interface LedgerSummaryProps {
  summary: Holding | WalletHoldings;
}

export function LedgerSummary({ summary }: LedgerSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{'quantity' in summary ? text.positionSummary : text.walletSummary}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {'quantity' in summary ? (
            <div>
              <dt className="text-muted-foreground">{text.quantity}</dt>
              <dd title={summary.quantity} className="wrap-anywhere tabular-nums">
                {formatQuantity(summary.quantity)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">{text.cost}</dt>
            <dd className="wrap-anywhere tabular-nums">{formatUsd(summary.remainingCostBasis)}</dd>
          </div>
          {'averageUnitCost' in summary ? (
            <div>
              <dt className="text-muted-foreground">{text.average}</dt>
              <dd className="wrap-anywhere tabular-nums">
                {summary.averageUnitCost === null
                  ? text.noAverage
                  : formatUsd(summary.averageUnitCost, 4)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">{text.realized}</dt>
            <dd className="wrap-anywhere tabular-nums">
              <ProfitLoss value={summary.realizedProfitLoss} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{text.lastTrade}</dt>
            <dd>{summary.lastTransactionDate ?? text.noDate}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
