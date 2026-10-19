import { zodResolver } from '@hookform/resolvers/zod';
import { type SubmitEvent, useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useActionData, useNavigation, useSubmit } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Instrument } from '@/lib/api/purchases';

import { usePurchaseQuote } from '../_hooks/usePurchaseQuote';
import { marketToday, purchaseFormSchema, type PurchaseFormValues } from '../_utils/purchaseForm';
import type { buyPurchaseAction } from '../BuyPurchaseModule';
import { purchaseDictionary as text } from '../purchaseDictionary';
import { InstrumentSearch } from './InstrumentSearch';
import { PurchasePrice } from './PurchasePrice';

interface PurchaseFormProps {
  walletId: string;
}

export function PurchaseForm({ walletId }: PurchaseFormProps) {
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);
  const navigation = useNavigation();
  const actionData = useActionData<typeof buyPurchaseAction>();
  const submit = useSubmit();
  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseFormSchema),
    mode: 'onBlur',
    defaultValues: { transactionDate: marketToday(), quantity: '', description: '' },
  });
  const transactionDate = useWatch({ control: form.control, name: 'transactionDate' });
  const quote = usePurchaseQuote({ walletId, symbol: selectedInstrument?.symbol, transactionDate });
  const { errors, isSubmitting } = form.formState;
  const isPending = isSubmitting || navigation.state !== 'idle';
  const isSaveUnconfirmed = actionData?.unconfirmed ?? false;
  const isDisabled = isPending || isSaveUnconfirmed;
  const canSubmit = !isDisabled && quote.state.status === 'ready';
  const { setError } = form;
  useEffect(() => {
    if (actionData?.error) setError('root', { type: 'server', message: actionData.error });
  }, [actionData, setError]);

  function selectInstrument(instrument: Instrument) {
    setSelectedInstrument(instrument);
    form.clearErrors('root');
    quote.requestQuote({
      symbol: instrument.symbol,
      transactionDate: form.getValues('transactionDate'),
    });
  }
  function clearSelectedInstrument() {
    setSelectedInstrument(null);
    form.clearErrors('root');
  }
  function handleTradeDateChange() {
    form.clearErrors('root');
    if (selectedInstrument) {
      quote.requestQuote({
        symbol: selectedInstrument.symbol,
        transactionDate: form.getValues('transactionDate'),
      });
    }
  }
  async function submitPurchase(values: PurchaseFormValues) {
    if (isDisabled) return;
    if (!selectedInstrument || quote.state.status !== 'ready') {
      form.setError('root', { message: text.invalid });
      return;
    }
    form.clearErrors('root');
    await submit(
      {
        ...values,
        symbol: selectedInstrument.symbol,
        side: 'BUY',
        unitPrice: quote.state.price.unitPrice,
        currency: quote.state.price.currency,
      },
      { method: 'post', encType: 'application/json' },
    );
  }
  function handleFormSubmit(event: SubmitEvent<HTMLFormElement>) {
    void form.handleSubmit(submitPurchase)(event);
  }
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-2">
      <InstrumentSearch
        walletId={walletId}
        selectedSymbol={selectedInstrument?.symbol}
        disabled={isDisabled}
        onSelect={selectInstrument}
        onChange={clearSelectedInstrument}
      />
      <Card>
        <CardHeader>
          <CardTitle>{text.details}</CardTitle>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={handleFormSubmit} className="flex min-w-0 flex-col gap-5">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.transactionDate)}>
                <FieldLabel htmlFor="trade-date">{text.date}</FieldLabel>
                <Input
                  id="trade-date"
                  type="date"
                  min="0001-01-01"
                  max={marketToday()}
                  required
                  disabled={isDisabled}
                  aria-invalid={Boolean(errors.transactionDate)}
                  aria-describedby="trade-date-hint trade-date-error"
                  {...form.register('transactionDate', {
                    onChange: handleTradeDateChange,
                  })}
                />
                <FieldDescription id="trade-date-hint">{text.dateHint}</FieldDescription>
                <FieldError id="trade-date-error">{errors.transactionDate?.message}</FieldError>
              </Field>
              <PurchasePrice
                instrument={selectedInstrument}
                state={quote.state}
                disabled={isDisabled}
                onRetry={quote.retryQuote}
              />
              <Field data-invalid={Boolean(errors.quantity)}>
                <FieldLabel htmlFor="purchase-quantity">{text.quantity}</FieldLabel>
                <Input
                  id="purchase-quantity"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={31}
                  required
                  disabled={isDisabled}
                  aria-invalid={Boolean(errors.quantity)}
                  aria-describedby="purchase-quantity-hint purchase-quantity-error"
                  {...form.register('quantity')}
                />
                <FieldDescription id="purchase-quantity-hint">{text.quantityHint}</FieldDescription>
                <FieldError id="purchase-quantity-error">
                  {errors.quantity ? text.invalidQuantity : undefined}
                </FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.description)}>
                <FieldLabel htmlFor="purchase-description">{text.descriptionLabel}</FieldLabel>
                <Textarea
                  id="purchase-description"
                  maxLength={500}
                  disabled={isDisabled}
                  aria-invalid={Boolean(errors.description)}
                  aria-describedby="purchase-description-error"
                  {...form.register('description')}
                />
                <FieldError id="purchase-description-error">
                  {errors.description?.message}
                </FieldError>
              </Field>
            </FieldGroup>
            {!isPending && errors.root?.message ? (
              <Alert variant="destructive">
                <AlertDescription>{errors.root.message}</AlertDescription>
              </Alert>
            ) : null}
            <p className="text-sm text-muted-foreground">{text.immutable}</p>
            <Button type="submit" disabled={!canSubmit}>
              {isPending ? text.submitting : text.submit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
