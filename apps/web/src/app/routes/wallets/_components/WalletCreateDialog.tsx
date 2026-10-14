import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useFetcher } from 'react-router';
import { toast } from 'sonner';
import { z as zod } from 'zod';

import { createWalletSchema } from '@my-wallets/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { walletDictionary } from '../_utils/walletDictionary';
import { walletsAction } from '../_utils/walletRouteData';

type WalletFormInput = zod.input<typeof createWalletSchema>;
type WalletFormOutput = zod.output<typeof createWalletSchema>;

export function WalletCreateDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const fetcher = useFetcher<typeof walletsAction>();
  const form = useForm<WalletFormInput, undefined, WalletFormOutput>({
    resolver: zodResolver(createWalletSchema),
    defaultValues: { name: '', description: '', reportingCurrency: 'USD' },
  });
  const nameError = form.formState.errors.name?.message;
  const descriptionError = form.formState.errors.description?.message;
  const rootError = form.formState.errors.root?.message;
  const isSubmitting = fetcher.state !== 'idle';

  useEffect(() => {
    const actionResult = fetcher.data;

    if (!actionResult) {
      return;
    }

    if (actionResult.status === 'created') {
      toast.success(walletDictionary.create.created(actionResult.walletName));
      form.reset();
      // The controlled dialog closes in response to the completed route action.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOpen(false);
      return;
    }

    const errorMessage = walletDictionary.create.failed;
    form.setError('root', { type: 'server', message: errorMessage });
    toast.error(errorMessage);
  }, [fetcher.data, form]);

  function handleOpenChange(open: boolean) {
    setIsOpen(open);

    if (!open && !isSubmitting) {
      form.reset();
    }
  }

  function submitWallet(values: WalletFormOutput) {
    form.clearErrors('root');
    void fetcher.submit(
      {
        name: values.name,
        reportingCurrency: values.reportingCurrency,
        ...(values.description === undefined ? {} : { description: values.description }),
      },
      { method: 'post', encType: 'application/json' },
    );
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <DialogTrigger asChild>
        <Button>{walletDictionary.page.createButton}</Button>
      </DialogTrigger>
      <DialogContent aria-describedby="wallet-create-description">
        <DialogHeader className="pr-12">
          <DialogTitle>{walletDictionary.create.title}</DialogTitle>
          <DialogDescription id="wallet-create-description">
            {walletDictionary.create.description}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-6"
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(submitWallet)(event);
          }}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(nameError)}>
              <FieldLabel htmlFor="wallet-name">{walletDictionary.create.name}</FieldLabel>
              <Input
                aria-describedby={nameError ? 'wallet-name-error' : undefined}
                aria-invalid={Boolean(nameError)}
                autoComplete="off"
                id="wallet-name"
                maxLength={100}
                placeholder={walletDictionary.create.namePlaceholder}
                required
                {...form.register('name')}
              />
              <FieldError id={nameError ? 'wallet-name-error' : undefined}>{nameError}</FieldError>
            </Field>
            <Field data-invalid={Boolean(descriptionError)}>
              <FieldLabel htmlFor="wallet-description">
                {walletDictionary.create.descriptionLabel}
              </FieldLabel>
              <Input
                aria-describedby={descriptionError ? 'wallet-description-error' : undefined}
                aria-invalid={Boolean(descriptionError)}
                id="wallet-description"
                maxLength={500}
                placeholder={walletDictionary.create.descriptionPlaceholder}
                {...form.register('description')}
              />
              <FieldError id={descriptionError ? 'wallet-description-error' : undefined}>
                {descriptionError}
              </FieldError>
            </Field>
            <Field aria-labelledby="wallet-currency-label">
              <FieldTitle id="wallet-currency-label">
                {walletDictionary.create.currencyLabel}
              </FieldTitle>
              <div className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3">
                <Badge variant="secondary">USD</Badge>
                <span className="text-sm text-muted-foreground">
                  {walletDictionary.create.currencyNote}
                </span>
              </div>
            </Field>
            {rootError ? (
              <Alert variant="destructive">
                <AlertDescription>{rootError}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <DialogFooter className="mt-auto">
            <DialogClose asChild>
              <Button disabled={isSubmitting} type="button" variant="outline">
                {walletDictionary.create.cancel}
              </Button>
            </DialogClose>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? walletDictionary.create.submitting : walletDictionary.create.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
