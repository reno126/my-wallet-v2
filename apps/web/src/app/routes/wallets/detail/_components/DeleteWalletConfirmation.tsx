import { type SubmitEventHandler, useId } from 'react';
import { type UseFormReturn, useWatch } from 'react-hook-form';
import { useSubmit } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { WalletSummary } from '@/lib/api/wallets';

import { walletDictionary as walletMsg } from '../../walletDictionary';

interface DeleteWalletConfirmationProps {
  wallet: WalletSummary;
  form: UseFormReturn<{ confirmationName: string }>;
  isPending: boolean;
}

export function DeleteWalletConfirmation({
  wallet,
  form,
  isPending,
}: DeleteWalletConfirmationProps) {
  const submit = useSubmit();
  const inputId = useId();
  const confirmationName = useWatch({ control: form.control, name: 'confirmationName' });
  const { errors } = form.formState;

  async function submitDeletion(values: { confirmationName: string }) {
    form.clearErrors('root');
    await submit(values, { method: 'delete', encType: 'application/json', replace: true });
  }

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = (event) => {
    if (isPending) {
      event.preventDefault();
      return;
    }
    void form.handleSubmit(submitDeletion)(event);
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={isPending}
      className="flex min-h-0 flex-1 flex-col gap-6"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{walletMsg.delete.finalTitle}</AlertDialogTitle>
        <AlertDialogDescription>{walletMsg.delete.finalWarning}</AlertDialogDescription>
      </AlertDialogHeader>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.confirmationName)} data-disabled={isPending}>
          <FieldLabel htmlFor={inputId}>{walletMsg.delete.nameLabel}</FieldLabel>
          <p className="min-w-0 wrap-anywhere font-medium">{wallet.name}</p>
          <Input
            id={inputId}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            disabled={isPending}
            aria-invalid={Boolean(errors.confirmationName)}
            aria-describedby={`${inputId}-hint${errors.confirmationName ? ` ${inputId}-error` : ''}`}
            {...form.register('confirmationName')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
              }
            }}
          />
          <FieldDescription id={`${inputId}-hint`}>{walletMsg.delete.nameHint}</FieldDescription>
          <FieldError id={`${inputId}-error`}>{errors.confirmationName?.message}</FieldError>
        </Field>
        {!isPending && errors.root?.message ? (
          <Alert variant="destructive">
            <AlertDescription>{errors.root.message}</AlertDescription>
          </Alert>
        ) : null}
      </FieldGroup>
      <AlertDialogFooter className="mt-auto sm:mt-0">
        <AlertDialogCancel disabled={isPending}>{walletMsg.delete.cancel}</AlertDialogCancel>
        <Button
          type="submit"
          variant="destructive"
          disabled={confirmationName !== wallet.name || isPending}
        >
          {isPending ? walletMsg.delete.submitting : walletMsg.delete.submit}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
