import { zodResolver } from '@hookform/resolvers/zod';
import { type SubmitEvent, useEffect, useId, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Holding } from '@/lib/api/ledger';
import { marketToday } from '@/lib/marketDate';

import type { useTransactionMutation } from '../_hooks/useTransactionMutation';
import { sellFormSchema, type SellFormValues } from '../_utils/sellForm';
import { ledgerDictionary as text } from '../ledgerDictionary';
import { MutationFailure } from './MutationFailure';
import { SaleFields } from './SaleFields';

interface SaleEditorProps {
  holding: Holding;
  mutation: ReturnType<typeof useTransactionMutation>;
  onClose: () => void;
}

export function SaleEditor({ holding, mutation, onClose }: SaleEditorProps) {
  const id = useId();
  const resolver = useMemo(() => zodResolver(sellFormSchema(holding.quantity)), [holding.quantity]);
  const defaultValues = useMemo(
    () => ({ quantity: '', unitPrice: '', transactionDate: marketToday(), description: '' }),
    [],
  );
  const form = useForm<SellFormValues>({ resolver, mode: 'onBlur', defaultValues });
  const busy = form.formState.isSubmitting || mutation.busy;
  const { failure, unconfirmed } = mutation;
  const { setError } = form;
  useEffect(() => {
    if (failure) {
      setError('root', { type: 'server', message: failure.error });
    }
  }, [failure, setError]);

  async function save(values: SellFormValues) {
    if (busy || unconfirmed) {
      return;
    }
    form.clearErrors('root');
    await mutation.submit(
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
        <SaleFields form={form} disabled={busy || unconfirmed} id={id} />
        {!busy && form.formState.errors.root?.message ? (
          <MutationFailure
            message={form.formState.errors.root.message}
            onRefreshed={() => {
              mutation.reset();
              form.clearErrors('root');
            }}
          />
        ) : null}
        <DialogFooter className="mt-auto">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {text.cancel}
          </Button>
          <Button type="submit" disabled={busy || unconfirmed}>
            {busy ? text.sell.pending : text.sell.submit}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
