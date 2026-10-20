import { useState } from 'react';
import { useFetcher, useRevalidator } from 'react-router';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { HistoryEntry } from '@/lib/api/ledger';
import { formatQuantity, formatUsd } from '@/lib/formatFinancial';

import { ledgerDictionary as text } from '../ledgerDictionary';
import type { transactionAction } from '../transactionAction';
import { MutationFailure } from './MutationFailure';

interface DeleteTransactionDialogProps {
  transaction: HistoryEntry;
  returnToWallet: boolean;
}

export function DeleteTransactionDialog({
  transaction,
  returnToWallet,
}: DeleteTransactionDialogProps) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<typeof transactionAction>();
  const revalidator = useRevalidator();
  const busy = fetcher.state !== 'idle' || revalidator.state !== 'idle';
  const failure = fetcher.data && 'error' in fetcher.data ? fetcher.data : undefined;
  const succeeded = fetcher.data?.ok && fetcher.state === 'idle';
  function changeOpen(next: boolean) {
    if (busy) {
      return;
    }
    if (next && !failure?.unconfirmed) {
      fetcher.reset();
    }
    setOpen(next);
  }
  return (
    <AlertDialog open={open && !succeeded} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto min-h-12 max-w-full py-2 whitespace-normal wrap-anywhere"
          disabled={busy}
        >
          {text.delete.open(transaction.symbol, transaction.side)}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{text.delete.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.delete.warning}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="wrap-anywhere tabular-nums">
          {transaction.side} {transaction.symbol} · {transaction.transactionDate} ·{' '}
          {formatQuantity(transaction.quantity)} {text.quantity} ·{' '}
          {formatUsd(transaction.totalAmount)}
        </p>
        {failure && !busy ? (
          <MutationFailure message={failure.error} onRefreshed={() => fetcher.reset()} />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{text.cancel}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy || Boolean(failure?.unconfirmed)}
            onClick={() =>
              void fetcher.submit(
                { transactionId: transaction.id, returnToWallet },
                {
                  method: 'delete',
                  action: `/wallets/${transaction.walletId}/transactions`,
                  encType: 'application/json',
                },
              )
            }
          >
            {busy ? text.delete.pending : text.delete.submit}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
