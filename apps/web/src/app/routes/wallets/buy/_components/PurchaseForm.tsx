import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useActionData, useFetcher, useNavigation, useSubmit } from 'react-router';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Instrument } from '@/lib/api/purchases';

import { marketToday, purchaseFormSchema, type PurchaseFormValues } from '../_utils/purchaseForm';
import type { buyPurchaseAction } from '../BuyPurchaseModule';
import { purchaseDictionary as text } from '../purchaseDictionary';
import type { purchasePriceLoader } from '../purchaseLookups';
import { InstrumentSearch } from './InstrumentSearch';
import { PurchasePrice } from './PurchasePrice';

interface PurchaseFormProps {
  walletId: string;
}

export function PurchaseForm({ walletId }: PurchaseFormProps) {
  const [selected, setSelected] = useState<Instrument | null>(null);
  const quote = useFetcher<typeof purchasePriceLoader>();
  const navigation = useNavigation();
  const actionData = useActionData<typeof buyPurchaseAction>();
  const submit = useSubmit();
  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseFormSchema),
    mode: 'onBlur',
    defaultValues: { transactionDate: marketToday(), quantity: '', description: '' },
  });
  const date = useWatch({ control: form.control, name: 'transactionDate' });
  const { errors, isSubmitting } = form.formState;
  const pending = isSubmitting || navigation.state !== 'idle';
  const unconfirmed = actionData?.unconfirmed ?? false;
  const price =
    quote.state === 'idle' &&
    selected &&
    quote.data?.status === 'ready' &&
    quote.data.price.symbol === selected.symbol &&
    quote.data.price.requestedDate === date
      ? quote.data.price
      : undefined;
  const priceError =
    quote.state === 'idle' &&
    selected &&
    quote.data?.status === 'error' &&
    quote.data.symbol === selected.symbol &&
    quote.data.date === date
      ? quote.data.message
      : undefined;
  const { setError } = form;
  useEffect(() => {
    if (actionData?.error) setError('root', { type: 'server', message: actionData.error });
  }, [actionData, setError]);
  useEffect(() => {
    if (priceError) toast.error(priceError);
  }, [priceError]);

  function loadPrice(instrument: Instrument, transactionDate: string) {
    if (!purchaseFormSchema.shape.transactionDate.safeParse(transactionDate).success) return;
    void quote.load(
      `/wallets/${walletId}/buy/price?${new URLSearchParams({ symbol: instrument.symbol, date: transactionDate })}`,
    );
  }
  function select(instrument: Instrument) {
    setSelected(instrument);
    form.clearErrors('root');
    loadPrice(instrument, form.getValues('transactionDate'));
  }
  async function save(values: PurchaseFormValues) {
    if (pending || unconfirmed) return;
    if (!selected || !price) {
      form.setError('root', { message: text.invalid });
      return;
    }
    form.clearErrors('root');
    await submit(
      {
        ...values,
        symbol: selected.symbol,
        side: 'BUY',
        unitPrice: price.unitPrice,
        currency: price.currency,
      },
      { method: 'post', encType: 'application/json' },
    );
  }
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-2">
      <InstrumentSearch
        walletId={walletId}
        selectedSymbol={selected?.symbol}
        disabled={pending || unconfirmed}
        onSelect={select}
        onChange={() => {
          setSelected(null);
          form.clearErrors('root');
        }}
      />
      <Card>
        <CardHeader>
          <CardTitle>{text.details}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={(event) => {
              void form.handleSubmit(save)(event);
            }}
            className="flex min-w-0 flex-col gap-5"
          >
            <FieldGroup>
              <Field data-invalid={Boolean(errors.transactionDate)}>
                <FieldLabel htmlFor="trade-date">{text.date}</FieldLabel>
                <Input
                  id="trade-date"
                  type="date"
                  min="0001-01-01"
                  max={marketToday()}
                  required
                  disabled={pending || unconfirmed}
                  aria-invalid={Boolean(errors.transactionDate)}
                  aria-describedby="trade-date-hint trade-date-error"
                  {...form.register('transactionDate', {
                    onChange: () => {
                      form.clearErrors('root');
                      if (selected) loadPrice(selected, form.getValues('transactionDate'));
                    },
                  })}
                />
                <FieldDescription id="trade-date-hint">{text.dateHint}</FieldDescription>
                <FieldError id="trade-date-error">
                  {errors.transactionDate?.message ? text.invalidDate : undefined}
                </FieldError>
              </Field>
              <PurchasePrice
                instrument={selected}
                price={price}
                error={priceError}
                loading={Boolean(selected) && quote.state !== 'idle'}
                disabled={pending || unconfirmed}
                onRetry={() => {
                  if (selected) loadPrice(selected, date);
                }}
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
                  disabled={pending || unconfirmed}
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
                  disabled={pending || unconfirmed}
                  aria-invalid={Boolean(errors.description)}
                  aria-describedby="purchase-description-error"
                  {...form.register('description')}
                />
                <FieldError id="purchase-description-error">
                  {errors.description?.message}
                </FieldError>
              </Field>
            </FieldGroup>
            {!pending && errors.root?.message ? (
              <Alert variant="destructive">
                <AlertDescription>{errors.root.message}</AlertDescription>
              </Alert>
            ) : null}
            <p className="text-sm text-muted-foreground">{text.immutable}</p>
            <Button type="submit" disabled={pending || !price || unconfirmed}>
              {pending ? text.submitting : text.submit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
