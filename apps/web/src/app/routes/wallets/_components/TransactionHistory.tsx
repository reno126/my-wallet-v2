import { Link, useLocation } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import type { TransactionHistory as History } from '@/lib/api/ledger';
import { formatQuantity, formatUsd } from '@/lib/formatFinancial';

import { ledgerDictionary as text } from '../ledgerDictionary';
import { DeleteTransactionDialog } from './DeleteTransactionDialog';
import { ProfitLoss } from './LedgerSummary';

interface TransactionHistoryProps {
  history: History;
  instrumentView?: boolean;
}

export function TransactionHistory({ history, instrumentView = false }: TransactionHistoryProps) {
  const location = useLocation();
  const { page, totalPages } = history.pagination;
  function pageLink(next: number) {
    const search = new URLSearchParams(location.search);
    search.set('page', String(next));
    return `${location.pathname}?${search}`;
  }
  return (
    <section aria-labelledby="history-title" className="flex min-w-0 flex-col gap-4">
      <h2 id="history-title" className="text-xl font-semibold">
        {text.history}
      </h2>
      {history.transactions.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{text.noTrades}</EmptyTitle>
            <EmptyDescription>{text.noTradesHint}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {history.transactions.map((transaction) => (
            <Card
              key={transaction.id}
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
                  ·{' '}
                  <time dateTime={transaction.transactionDate}>{transaction.transactionDate}</time>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex min-w-0 flex-col gap-4">
                <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">{text.quantity}</dt>
                    <dd title={transaction.quantity} className="wrap-anywhere tabular-nums">
                      {formatQuantity(transaction.quantity)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{text.price}</dt>
                    <dd title={transaction.unitPrice} className="wrap-anywhere tabular-nums">
                      {formatUsd(transaction.unitPrice, 4)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{text.amount}</dt>
                    <dd className="wrap-anywhere tabular-nums">
                      {formatUsd(transaction.totalAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{text.realized}</dt>
                    <dd className="wrap-anywhere tabular-nums">
                      {transaction.realizedProfitLoss === null ? (
                        '—'
                      ) : (
                        <ProfitLoss value={transaction.realizedProfitLoss} />
                      )}
                    </dd>
                  </div>
                </dl>
                {transaction.description ? (
                  <p className="wrap-anywhere whitespace-pre-wrap">{transaction.description}</p>
                ) : null}
                <p className="text-xs wrap-anywhere text-muted-foreground">
                  {text.recorded}:{' '}
                  <time dateTime={transaction.createdAt}>{transaction.createdAt}</time>
                </p>
                {transaction.canDelete ? (
                  <div>
                    <DeleteTransactionDialog
                      transaction={transaction}
                      returnToWallet={instrumentView && history.pagination.totalCount === 1}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {totalPages > 1 ? (
        <nav aria-label={text.pagination} className="flex flex-wrap items-center gap-3">
          {page > 1 ? (
            <Button asChild variant="outline">
              <Link to={pageLink(page - 1)}>{text.previous}</Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              {text.previous}
            </Button>
          )}
          <p className="text-sm" role="status">
            {text.page(page, totalPages)}
          </p>
          {page < totalPages ? (
            <Button asChild variant="outline">
              <Link to={pageLink(page + 1)}>{text.next}</Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              {text.next}
            </Button>
          )}
        </nav>
      ) : null}
    </section>
  );
}
