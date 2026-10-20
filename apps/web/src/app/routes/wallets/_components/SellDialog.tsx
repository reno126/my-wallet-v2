import { zodResolver } from '@hookform/resolvers/zod';
import { type SubmitEvent, useEffect, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useFetcher, useRevalidator } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { Holding } from '@/lib/api/ledger';
import { marketToday } from '@/lib/marketDate';

import { sellFormSchema, type SellFormValues } from '../_utils/sellForm';
import { ledgerDictionary as text } from '../ledgerDictionary';
import type { transactionAction } from '../transactionAction';
import { MutationFailure } from './MutationFailure';
import { SaleFields } from './SaleFields';

interface SellDialogProps {
  holding: Holding;
}

export function SellDialog({ holding }: SellDialogProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const fetcher = useFetcher<typeof transactionAction>();
  const revalidator = useRevalidator();
  const form = useForm<SellFormValues>({
    resolver: zodResolver(sellFormSchema(holding.quantity)),
    mode: 'onBlur',
    defaultValues: { quantity: '', unitPrice: '', transactionDate: marketToday(), description: '' },
  });
  const busy =
    form.formState.isSubmitting || fetcher.state !== 'idle' || revalidator.state !== 'idle';
  const failure = fetcher.data && 'error' in fetcher.data ? fetcher.data : undefined;
  const { setError } = form;
  useEffect(() => {
    if (failure) {
      setError('root', { type: 'server', message: failure.error });
    }
  }, [failure, setError]);
  const succeeded = fetcher.data?.ok && fetcher.state === 'idle';

  function changeOpen(next: boolean) {
    if (busy) {
      return;
    }
    if (next && !failure?.unconfirmed) {
      fetcher.reset();
      form.reset();
    }
    setOpen(next);
  }
  async function save(values: SellFormValues) {
    if (busy || failure?.unconfirmed) {
      return;
    }
    form.clearErrors('root');
    await fetcher.submit(
      { ...values, symbol: holding.symbol, side: 'SELL', currency: holding.quoteCurrency },
      {
        method: 'post',
        action: `/wallets/${holding.walletId}/transactions`,
        encType: 'application/json',
      },
    );
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    void form.handleSubmit(save)(event);
  }
  return (
    <Dialog open={open && !succeeded} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto min-h-12 max-w-full py-2 whitespace-normal wrap-anywhere"
          disabled={holding.quantity === '0' || busy}
        >
          {text.sell.open(holding.symbol)}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{text.sell.title}</DialogTitle>
          <DialogDescription>{text.sell.description}</DialogDescription>
        </DialogHeader>
        <p className="wrap-anywhere font-medium">
          {holding.symbol} · {holding.name}
        </p>
        <p className="wrap-anywhere tabular-nums">
          {text.sell.available}: {holding.quantity}
        </p>
        <form
          noValidate
          onSubmit={submit}
          aria-busy={busy}
          className="flex min-h-0 flex-1 flex-col gap-5"
        >
          <SaleFields form={form} disabled={busy || Boolean(failure?.unconfirmed)} id={id} />
          {!busy && form.formState.errors.root?.message ? (
            <MutationFailure
              message={form.formState.errors.root.message}
              onRefreshed={() => {
                fetcher.reset();
                form.clearErrors('root');
              }}
            />
          ) : null}
          <DialogFooter className="mt-auto">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => changeOpen(false)}
            >
              {text.cancel}
            </Button>
            <Button type="submit" disabled={busy || Boolean(failure?.unconfirmed)}>
              {busy ? text.sell.pending : text.sell.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
