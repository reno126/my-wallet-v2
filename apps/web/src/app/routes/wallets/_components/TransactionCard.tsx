import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { HistoryEntry } from '@/lib/api/ledger';
import { formatQuantity, formatUsd } from '@/lib/formatFinancial';

import { ledgerDictionary as text } from '../ledgerDictionary';
import { DeleteTransactionDialog } from './DeleteTransactionDialog';
import { LedgerMetric } from './LedgerMetric';
import { ProfitLoss } from './ProfitLoss';

interface TransactionCardProps {
  transaction: HistoryEntry;
  returnToWallet: boolean;
}

export function TransactionCard({ transaction, returnToWallet }: TransactionCardProps) {
  return (
    <Card
      role="article"
      aria-label={`${transaction.side} ${transaction.symbol} ${transaction.transactionDate}`}
    >
      <CardHeader>
        <CardTitle as="h3">
          <Link
            to={`/wallets/${transaction.walletId}/instruments/${encodeURIComponent(transaction.symbol)}`}
          >
            {transaction.symbol}
          </Link>
        </CardTitle>
        <CardDescription>
          <Badge variant={transaction.side === 'BUY' ? 'secondary' : 'outline'}>
            {transaction.side}
          </Badge>{' '}
          · <time dateTime={transaction.transactionDate}>{transaction.transactionDate}</time>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LedgerMetric label={text.quantity} exactValue={transaction.quantity}>
            {formatQuantity(transaction.quantity)}
          </LedgerMetric>
          <LedgerMetric label={text.price} exactValue={transaction.unitPrice}>
            {formatUsd(transaction.unitPrice, 4)}
          </LedgerMetric>
          <LedgerMetric label={text.amount}>{formatUsd(transaction.totalAmount)}</LedgerMetric>
          <LedgerMetric label={text.realized}>
            {transaction.realizedProfitLoss === null ? (
              '—'
            ) : (
              <ProfitLoss value={transaction.realizedProfitLoss} />
            )}
          </LedgerMetric>
        </dl>
        {transaction.description ? (
          <p className="wrap-anywhere whitespace-pre-wrap">{transaction.description}</p>
        ) : null}
        <p className="text-xs wrap-anywhere text-muted-foreground">
          {text.recorded}: <time dateTime={transaction.createdAt}>{transaction.createdAt}</time>
        </p>
        {transaction.canDelete ? (
          <div>
            <DeleteTransactionDialog transaction={transaction} returnToWallet={returnToWallet} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
