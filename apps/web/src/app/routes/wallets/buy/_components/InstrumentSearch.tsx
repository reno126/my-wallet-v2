import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useFetcher } from 'react-router';
import type { z as zod } from 'zod';

import { instrumentSearchQuerySchema } from '@my-wallets/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Instrument } from '@/lib/api/purchases';

import { purchaseDictionary as text } from '../purchaseDictionary';
import type { instrumentSearchLoader } from '../purchaseLookups';

const searchFormSchema = instrumentSearchQuerySchema.extend({
  mode: instrumentSearchQuerySchema.shape.mode.removeDefault(),
});

interface InstrumentSearchProps {
  walletId: string;
  selectedSymbol?: string | undefined;
  disabled: boolean;
  onSelect: (instrument: Instrument) => void;
  onChange: () => void;
}

export function InstrumentSearch({
  walletId,
  selectedSymbol,
  disabled,
  onSelect,
  onChange,
}: InstrumentSearchProps) {
  const fetcher = useFetcher<typeof instrumentSearchLoader>();
  const [hasSearched, setHasSearched] = useState(false);
  const form = useForm<zod.infer<typeof searchFormSchema>>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: { q: '', mode: 'symbol' },
  });
  const pending = fetcher.state !== 'idle';
  const result = hasSearched && !pending ? fetcher.data : undefined;
  function invalidate() {
    setHasSearched(false);
    onChange();
  }
  async function search(values: zod.infer<typeof instrumentSearchQuerySchema>) {
    setHasSearched(true);
    onChange();
    await fetcher.load(`/wallets/${walletId}/buy/search?${new URLSearchParams(values)}`);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.searchTitle}</CardTitle>
        <CardDescription>{text.searchHint}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        <form
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(search)(event);
          }}
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            <Field>
              <FieldLabel id="search-mode-label">{text.searchMode}</FieldLabel>
              <Controller
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={field.value}
                    disabled={disabled}
                    aria-labelledby="search-mode-label"
                    onValueChange={(value) => {
                      if (value !== 'symbol' && value !== 'name') {
                        return;
                      }
                      field.onChange(value);
                      invalidate();
                    }}
                  >
                    <ToggleGroupItem value="symbol" className="min-h-12 flex-1">
                      {text.symbol}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="name" className="min-h-12 flex-1">
                      {text.company}
                    </ToggleGroupItem>
                  </ToggleGroup>
                )}
              />
            </Field>
            <Field data-invalid={Boolean(form.formState.errors.q)}>
              <FieldLabel htmlFor="stock-search">{text.searchLabel}</FieldLabel>
              <Input
                id="stock-search"
                autoComplete="off"
                maxLength={100}
                disabled={disabled}
                aria-invalid={Boolean(form.formState.errors.q)}
                aria-describedby="stock-search-error"
                {...form.register('q', { onChange: invalidate })}
              />
              <FieldError id="stock-search-error">{form.formState.errors.q?.message}</FieldError>
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={disabled || pending || form.formState.isSubmitting}>
            {pending ? text.searching : text.search}
          </Button>
        </form>
        <div aria-live="polite" aria-busy={pending}>
          {pending ? (
            <div role="status" className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{text.searching}</p>
              <Skeleton className="h-20 w-full" />
            </div>
          ) : null}
          {result?.status === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          ) : null}
          {result?.status === 'ready' ? (
            <div className="flex flex-col gap-4">
              {result.results.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{text.empty}</EmptyTitle>
                    <EmptyDescription>{text.emptyHint}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul aria-label={text.results} className="flex flex-col gap-3">
                  {result.results.map((instrument) => (
                    <li key={instrument.symbol}>
                      <Button
                        type="button"
                        variant={selectedSymbol === instrument.symbol ? 'secondary' : 'outline'}
                        disabled={disabled}
                        aria-label={text.select(instrument.symbol)}
                        aria-pressed={selectedSymbol === instrument.symbol}
                        className="h-auto min-h-16 w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal"
                        onClick={() => onSelect(instrument)}
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-1 wrap-anywhere">
                          <span className="font-semibold">{instrument.symbol}</span>
                          <span className="text-sm font-normal text-muted-foreground">
                            {instrument.name}
                          </span>
                          {instrument.exchange ? (
                            <span className="text-xs text-muted-foreground">
                              {instrument.exchange}
                            </span>
                          ) : null}
                        </span>
                        <Badge variant="secondary">{instrument.quoteCurrency}</Badge>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {result.excluded.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                  {result.excluded.map((item) => (
                    <li key={item.symbol} className="wrap-anywhere">
                      <span className="font-medium">{item.symbol}</span>:{' '}
                      {text.excluded[item.reason]}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
