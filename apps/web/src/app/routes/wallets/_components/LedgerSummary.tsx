import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Holding, WalletHoldings } from '@/lib/api/ledger';
import { formatQuantity, formatUsd } from '@/lib/formatFinancial';

import { ledgerDictionary as text } from '../ledgerDictionary';
import { LedgerMetric } from './LedgerMetric';
import { ProfitLoss } from './ProfitLoss';

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
            <LedgerMetric label={text.quantity} exactValue={summary.quantity}>
              {formatQuantity(summary.quantity)}
            </LedgerMetric>
          ) : null}
          <LedgerMetric label={text.cost}>{formatUsd(summary.remainingCostBasis)}</LedgerMetric>
          {'averageUnitCost' in summary ? (
            <LedgerMetric label={text.average}>
              {summary.averageUnitCost === null
                ? text.noAverage
                : formatUsd(summary.averageUnitCost, 4)}
            </LedgerMetric>
          ) : null}
          <LedgerMetric label={text.realized}>
            <ProfitLoss value={summary.realizedProfitLoss} />
          </LedgerMetric>
          <LedgerMetric label={text.lastTrade}>
            {summary.lastTransactionDate ?? text.noDate}
          </LedgerMetric>
        </dl>
      </CardContent>
    </Card>
  );
}
