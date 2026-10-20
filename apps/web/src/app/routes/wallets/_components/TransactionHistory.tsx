import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import type { TransactionHistory as History } from '@/lib/api/ledger';

import { ledgerDictionary as text } from '../ledgerDictionary';
import { HistoryPagination } from './HistoryPagination';
import { TransactionCard } from './TransactionCard';

interface TransactionHistoryProps {
  history: History;
  instrumentView?: boolean;
}

export function TransactionHistory({ history, instrumentView = false }: TransactionHistoryProps) {
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
            <TransactionCard
              key={transaction.id}
              transaction={transaction}
              returnToWallet={instrumentView && history.pagination.totalCount === 1}
            />
          ))}
        </div>
      )}
      <HistoryPagination
        page={history.pagination.page}
        totalPages={history.pagination.totalPages}
      />
    </section>
  );
}
