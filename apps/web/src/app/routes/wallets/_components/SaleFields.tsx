import { type UseFormReturn, useWatch } from 'react-hook-form';

import { positiveDecimalStringSchema } from '@my-wallets/contracts';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatUsd, multiplyDecimals } from '@/lib/formatFinancial';
import { marketToday } from '@/lib/marketDate';

import type { SellFormValues } from '../_utils/sellForm';
import { ledgerDictionary as text } from '../ledgerDictionary';

interface SaleFieldsProps {
  form: UseFormReturn<SellFormValues>;
  disabled: boolean;
  id: string;
}

export function SaleFields({ form, disabled, id }: SaleFieldsProps) {
  const [quantity, unitPrice] = useWatch({
    control: form.control,
    name: ['quantity', 'unitPrice'],
  });
  const valid =
    positiveDecimalStringSchema.safeParse(quantity).success &&
    positiveDecimalStringSchema.safeParse(unitPrice).success;
  const { errors } = form.formState;
  return (
    <FieldGroup>
      <Field data-invalid={Boolean(errors.quantity)}>
        <FieldLabel htmlFor={`${id}-quantity`}>{text.sell.quantity}</FieldLabel>
        <Input
          id={`${id}-quantity`}
          type="text"
          inputMode="decimal"
          maxLength={31}
          required
          disabled={disabled}
          aria-invalid={Boolean(errors.quantity)}
          aria-describedby={`${id}-quantity-error`}
          {...form.register('quantity')}
        />
        <FieldDescription>{text.sell.precision}</FieldDescription>
        <FieldError id={`${id}-quantity-error`}>
          {errors.quantity ? text.sell.invalidQuantity : undefined}
        </FieldError>
      </Field>
      <Field data-invalid={Boolean(errors.unitPrice)}>
        <FieldLabel htmlFor={`${id}-price`}>{text.sell.price}</FieldLabel>
        <Input
          id={`${id}-price`}
          type="text"
          inputMode="decimal"
          maxLength={31}
          required
          disabled={disabled}
          aria-invalid={Boolean(errors.unitPrice)}
          aria-describedby={`${id}-price-error`}
          {...form.register('unitPrice')}
        />
        <FieldError id={`${id}-price-error`}>
          {errors.unitPrice ? text.sell.invalidPrice : undefined}
        </FieldError>
      </Field>
      <Field data-invalid={Boolean(errors.transactionDate)}>
        <FieldLabel htmlFor={`${id}-date`}>{text.sell.date}</FieldLabel>
        <Input
          id={`${id}-date`}
          type="date"
          min="0001-01-01"
          max={marketToday()}
          required
          disabled={disabled}
          aria-invalid={Boolean(errors.transactionDate)}
          aria-describedby={`${id}-date-error`}
          {...form.register('transactionDate')}
        />
        <FieldError id={`${id}-date-error`}>
          {errors.transactionDate ? text.sell.invalidDate : undefined}
        </FieldError>
      </Field>
      <Field data-invalid={Boolean(errors.description)}>
        <FieldLabel htmlFor={`${id}-description`}>{text.sell.descriptionLabel}</FieldLabel>
        <Textarea
          id={`${id}-description`}
          maxLength={500}
          disabled={disabled}
          aria-invalid={Boolean(errors.description)}
          {...form.register('description')}
        />
        <FieldError>{errors.description?.message}</FieldError>
      </Field>
      <div role="status" className="flex flex-col gap-2">
        <p className="wrap-anywhere font-medium tabular-nums">
          {text.sell.proceeds}: {valid ? formatUsd(multiplyDecimals(quantity, unitPrice)) : '—'}
        </p>
        <p className="text-sm text-muted-foreground">{text.sell.proceedsHint}</p>
      </div>
    </FieldGroup>
  );
}
